import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch


class TargetInvocationException(Exception):
    def __init__(self, inner):
        super().__init__('Exception has been thrown by the target of an invocation')
        self.InnerException = inner


# Only .NET imports are unavailable in CPython. The operation orchestrator and
# compiler diagnostic gate below are the maintained code, not copied logic.
with patch.dict(sys.modules, {
    'System': SimpleNamespace(Activator=None, AppDomain=None, Array=None, Object=None,
                              Enum=SimpleNamespace(Parse=lambda kind, value: value),
                              Environment=SimpleNamespace(ProcessorCount=2)),
    'System.Net': SimpleNamespace(Dns=SimpleNamespace(GetHostAddresses=lambda host: ['127.0.0.1']),
                                  IPAddress=SimpleNamespace(Parse=lambda address: address)),
    'System.Reflection': SimpleNamespace(BindingFlags=None, TargetInvocationException=TargetInvocationException),
}):
    import codesys_online


class OnlineLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.messages = []
        self.ids = {'codeId': 'downloaded-code', 'dataId': 'downloaded-data'}
        self.app = SimpleNamespace(
            guid='application-guid', parent=SimpleNamespace(is_device=True),
            get_children=lambda: [], get_name=lambda: 'Application',
            is_uptodate=False, is_online_change_possible=True,
        )
        self.app.parent.set_gateway_and_ip_address = Mock()
        self.project = SimpleNamespace(active_application=self.app, save=Mock(), close=Mock())
        self.source_imported = False
        self.wrapper = None
        self.core = SimpleNamespace(Logout=Mock(), Login=Mock(return_value=True),
                                    CreateBootProject=Mock(), Download=Mock())
        self.boot_method = Mock()
        self.boot_method.Invoke.side_effect = lambda core, args: core.CreateBootProject()
        self.boot_api = SimpleNamespace(GetMethod=Mock(return_value=self.boot_method))

        def clean():
            self.events.append('clean')
        def compile_source():
            self.assertTrue(self.source_imported)
            self.events.append('compile')
        self.app.clean = Mock(side_effect=clean)
        self.app.rebuild = Mock(side_effect=compile_source)
        self.app.build = Mock(side_effect=compile_source)
        self.app.generate_code = Mock(side_effect=lambda: self.events.append('generate'))

        def wrapper(application):
            self.events.append('online-wrapper')
            self.wrapper = SimpleNamespace(
                login=Mock(), start=Mock(), logout=Mock(), Dispose=Mock(),
                read_value=Mock(return_value='42'),
            )
            return self.wrapper
        self.engine = SimpleNamespace(
            projects=SimpleNamespace(open=Mock(return_value=self.project)),
            online=SimpleNamespace(
                gateways=SimpleNamespace(add_new_gateway=Mock(return_value=SimpleNamespace(guid='gateway'))),
                create_online_device=Mock(return_value=SimpleNamespace(Dispose=Mock())),
                create_online_application=Mock(side_effect=wrapper),
            ),
            OnlineChangeOption=SimpleNamespace(Never='Never'),
            Severity=SimpleNamespace(Error=1, FatalError=2),
            system=SimpleNamespace(
                get_message_categories=lambda: ['compiler'],
                clear_messages=lambda category: self.messages.clear(),
                get_message_objects=lambda category, severity: self.messages,
            ),
        )
        def imported(*args):
            self.events.append('import')
            self.source_imported = True
        replacements = {
            'import_objects': Mock(side_effect=imported),
            'core_application': Mock(return_value=self.core),
            'session_login': Mock(),
            'controller_ids': Mock(return_value=self.ids),
            'controller_state': Mock(return_value='run'),
            'require_current_boot_project': Mock(),
            'load_downloaded_reference': Mock(return_value=self.ids),
            'reconcile': Mock(),
            'generate_online_code': Mock(),
            'consolidated_manager': Mock(return_value=SimpleNamespace(GetCompileContext=Mock())),
            'context_ids': Mock(return_value=self.ids),
            'loaded_type': Mock(side_effect=lambda name:
                                self.boot_api if name == '_3S.CoDeSys.Core.Online.IOnlineApplication3' else None),
        }
        patcher = patch.multiple(codesys_online, **replacements)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.request = {
            'project': 'Application.project', 'operation': 'download', 'symbols': False,
            'objects': [], 'removeObjects': ['Visualization Manager'],
            'online': {'gateway': {'host': 'gateway', 'port': 1217},
                       'device': {'host': 'plc', 'port': 11740}},
        }

    def test_download_rebuilds_imported_tree_before_online_login(self):
        result = codesys_online.run_online(self.engine, self.request)
        self.assertEqual(self.events, ['import', 'clean', 'compile', 'generate', 'online-wrapper'])
        self.assertEqual(result['controllerIds'], self.ids)
        self.core.CreateBootProject.assert_called_once()
        self.boot_api.GetMethod.assert_called_once_with('CreateBootProject')
        self.boot_method.Invoke.assert_called_once_with(self.core, None)
        self.project.close.assert_called_once()
        self.app.build.assert_not_called()

    def test_invalid_full_download_source_never_creates_online_wrapper_or_transfers(self):
        self.app.rebuild.side_effect = RuntimeError('Invalid source declaration')
        with self.assertRaisesRegex(RuntimeError, 'Invalid source declaration'):
            codesys_online.run_online(self.engine, self.request)
        self.engine.online.create_online_application.assert_not_called()
        self.core.CreateBootProject.assert_not_called()
        self.project.close.assert_called_once()

    def test_online_change_keeps_the_downloaded_reference_and_builds_incrementally(self):
        self.request.update(operation='online-change', baseline={
            'applicationGuid': self.app.guid, 'controllerIds': self.ids, 'objects': [],
        })
        result = codesys_online.run_online(self.engine, self.request)
        self.assertEqual(self.events, ['online-wrapper', 'import', 'compile'])
        self.app.clean.assert_not_called()
        self.app.rebuild.assert_not_called()
        self.app.generate_code.assert_not_called()
        self.core.Download.assert_called_once_with(True, 'UseProjectSetting')
        self.assertEqual(result['state'], 'run')

    def test_full_download_rejects_library_errors_reported_after_transfer(self):
        def report_library_error(core):
            self.messages.append(SimpleNamespace(text="Could not open library '#VisuShared'."))
        codesys_online.session_login.side_effect = report_library_error
        with self.assertRaisesRegex(RuntimeError, "Could not open library '#VisuShared'"):
            codesys_online.run_online(self.engine, self.request)
        self.core.CreateBootProject.assert_called_once()
        self.project.close.assert_called_once()

    def test_boot_failure_preserves_vendor_clr_stack_and_never_confirms_completion(self):
        stack = ('System.ArgumentException: The path is not of a legal form.\n'
                 '   at System.IO.Path.GetFullPath(String path)\n'
                 '   at Vendor.BootProvider.PrepareTransfer()')
        self.core.CreateBootProject.side_effect = TargetInvocationException(
            SimpleNamespace(ToString=lambda: stack))
        with self.assertRaises(RuntimeError) as failure:
            codesys_online.run_online(self.engine, self.request)
        self.assertEqual(str(failure.exception), 'Controller boot project creation failed:\n' + stack)
        self.core.CreateBootProject.assert_called_once()
        codesys_online.require_current_boot_project.assert_not_called()
        codesys_online.session_login.assert_not_called()
        self.project.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
