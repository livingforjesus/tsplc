import importlib.util
import io
import json
import os
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stderr, redirect_stdout
from types import SimpleNamespace
from unittest.mock import Mock, patch


path = Path(__file__).parent.parent / 'docker' / 'install' / 'verify.py'
spec = importlib.util.spec_from_file_location('installer_verification', path)
verification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verification)


class InstallerVerificationTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.dict(sys.modules, {
            'System': SimpleNamespace(Guid=lambda value: value),
        })
        patcher.start()
        self.addCleanup(patcher.stop)
        self.events = []
        self.messages = []
        self.program = SimpleNamespace(
            textual_declaration=SimpleNamespace(replace=Mock()),
            textual_implementation=SimpleNamespace(replace=Mock()),
        )
        self.task = SimpleNamespace(pous=SimpleNamespace(add=Mock()))
        self.manager = SimpleNamespace(
            get_libraries=Mock(side_effect=lambda **args: self.events.append('libraries')),
        )
        task_configuration = SimpleNamespace(create_task=Mock(return_value=self.task))
        self.application = SimpleNamespace(
            create_program=Mock(return_value=self.program),
            create_task_configuration=Mock(return_value=task_configuration),
            create_symbol_config=Mock(),
            get_library_manager=Mock(return_value=self.manager),
            clean=Mock(side_effect=lambda: self.events.append('clean')),
            rebuild=Mock(side_effect=lambda: self.events.append('compile')),
            generate_code=Mock(side_effect=lambda: self.events.append('generate')),
            create_boot_application=Mock(side_effect=lambda *args: self.events.append('boot')),
        )
        self.project = SimpleNamespace(
            active_application=self.application,
            add=Mock(),
            save=Mock(),
            close=Mock(side_effect=lambda: self.events.append('close')),
        )

        def opened(*args, **kwargs):
            self.events.append('open')
            return self.project

        self.engine = SimpleNamespace(
            projects=SimpleNamespace(
                create=Mock(return_value=self.project),
                open=Mock(side_effect=opened),
            ),
            device_repository=SimpleNamespace(import_device=Mock(), sources=['repository']),
            KindOfTask=SimpleNamespace(Cyclic='cyclic'),
            Severity=SimpleNamespace(Error=1, FatalError=2),
            ScriptPromptHandling=SimpleNamespace(LogPrompts='log'),
            system=SimpleNamespace(
                get_message_categories=lambda: ['compiler', 'libraries'],
                get_message_objects=lambda category, severity: self.messages if category == 'libraries' else [],
                clear_messages=lambda category: self.messages.clear(),
                delay=Mock(side_effect=lambda duration: self.events.append('delay')),
            ),
        )

    def test_compiles_published_program_for_bundled_device_and_reopens_the_project(self):
        verification.verify(self.engine)
        self.project.add.assert_called_once_with('Device', 4096, '0000 1008', '4.22.0.0')
        self.assertIn(
            "{attribute 'symbol' := 'readwrite'}",
            self.program.textual_declaration.replace.call_args.args[0],
        )
        self.assertEqual(self.task.kind_of_task, 'cyclic')
        self.assertEqual(self.task.interval, '20')
        self.task.pous.add.assert_called_once_with('PLC_PRG')
        self.assertEqual(self.application.create_symbol_config.call_args.args[:2], (True, True))
        self.assertEqual(self.events, [
            'clean', 'compile', 'generate', 'boot', 'close',
            'open', 'libraries', 'delay', 'close',
        ])
        self.manager.get_libraries.assert_called_once_with(recursive=True)

    def test_rejects_transitive_library_errors_reported_when_reopening_saved_project(self):
        def report_late_errors(duration):
            self.messages.append(SimpleNamespace(
                text="Could not open library '#VisuShared'.",
                project=SimpleNamespace(path=r'C:\Managed Libraries\AlarmManager.compiled-library-v3'),
            ))
        self.engine.system.delay.side_effect = report_late_errors
        with self.assertRaisesRegex(
            RuntimeError,
            "AlarmManager.compiled-library-v3: Could not open library '#VisuShared'",
        ):
            verification.verify(self.engine)
        self.engine.projects.open.assert_called_once()
        self.assertEqual(self.project.close.call_count, 2)

    def test_compile_error_stops_before_boot_artifact_and_saved_project_reopen(self):
        self.application.rebuild.side_effect = lambda: self.messages.append(SimpleNamespace(text='Invalid source'))
        with self.assertRaisesRegex(RuntimeError, 'Invalid source'):
            verification.verify(self.engine)
        self.application.generate_code.assert_not_called()
        self.application.create_boot_application.assert_not_called()
        self.engine.projects.open.assert_not_called()
        self.project.close.assert_called_once()

    def run_verifier_main(self):
        owner = self

        class Kernel:
            @property
            def ExitProcess(self):
                owner.assertEqual(owner.events, [], 'Bind native exit before compiler work')
                return lambda status: sys.exit(status)

        output = io.StringIO()
        errors = io.StringIO()
        with patch.dict(sys.modules, {
            'ctypes': SimpleNamespace(windll=SimpleNamespace(kernel32=Kernel())),
            'scriptengine': self.engine,
        }), redirect_stdout(output), redirect_stderr(errors):
            with self.assertRaises(SystemExit) as exit:
                runpy.run_path(str(path), run_name='__main__')
        return exit.exception.code, output.getvalue(), errors.getvalue()

    def test_main_prebinds_native_exit_and_returns_zero_after_verification(self):
        status, output, errors = self.run_verifier_main()
        self.assertEqual(status, 0)
        self.assertIn('project reopen: PASS', output)
        self.assertEqual(errors, '')

    def test_main_keeps_compile_failure_and_returns_one_using_prebound_native_exit(self):
        self.application.rebuild.side_effect = lambda: self.messages.append(SimpleNamespace(text='Invalid source'))
        status, output, errors = self.run_verifier_main()
        self.assertEqual(status, 1)
        self.assertNotIn('PASS', output)
        self.assertIn('Invalid source', errors)
        self.application.create_boot_application.assert_not_called()


class InstallerVerificationCommandTests(unittest.TestCase):
    """Run the maintained shell gate with only Wine's process boundary replaced."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='vplc verification ')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.prefix = self.root / 'wine prefix'
        (self.prefix / 'drive_c').mkdir(parents=True)
        self.calls = self.root / 'calls.jsonl'
        timeout = self.root / 'timeout'
        timeout.write_text(
            '#!' + sys.executable + '\n'
            'import json, os, pathlib, sys\n'
            'prefix = pathlib.Path(os.environ["WINEPREFIX"]) / "drive_c"\n'
            'for extension, content in json.loads(os.environ["VPLC_VERIFICATION_FILES"]).items():\n'
            ' (prefix / ("codesys-verification." + extension)).write_text(content)\n'
            'with pathlib.Path(os.environ["VPLC_VERIFICATION_CALLS"]).open("a") as output:\n'
            ' output.write(json.dumps({"command": sys.argv[1:], "debug": os.environ["WINEDEBUG"]}) + "\\n")\n'
            'pathlib.Path(sys.argv[-1]).write_text(os.environ["VPLC_VERIFICATION_TRANSCRIPT"])\n'
            'print("Fixture vendor verification result")\n'
            'sys.exit(int(os.environ["VPLC_VERIFICATION_STATUS"]))\n'
        )
        timeout.chmod(0o755)
        wineserver = self.root / 'wineserver'
        wineserver.write_text(
            '#!' + sys.executable + '\n'
            'import json, os, pathlib, sys\n'
            'with pathlib.Path(os.environ["VPLC_VERIFICATION_CALLS"]).open("a") as output:\n'
            ' output.write(json.dumps({"wineserver": sys.argv[1:]}) + "\\n")\n'
        )
        wineserver.chmod(0o755)

    def run_verifier(self, status=0, files=None, transcript='Fixture vendor verification result\n'):
        if files is None:
            files = {extension: 'Vendor artifact' for extension in ('project', 'app', 'crc')}
        result = subprocess.run(
            ['sh', str(path.with_name('verify.sh'))],
            env={**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                'WINEPREFIX': str(self.prefix), 'VPLC_VERIFICATION_STATUS': str(status),
                'VPLC_VERIFICATION_FILES': json.dumps(files),
                'VPLC_VERIFICATION_TRANSCRIPT': transcript,
                'VPLC_VERIFICATION_CALLS': str(self.calls)},
            capture_output=True, text=True,
        )
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        return result, calls

    def test_success_requires_all_boot_files_before_stopping_the_template_wine_server(self):
        result, calls = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[0]['debug'], '-all,err+seh')
        self.assertEqual(calls[0]['command'], [
            '--foreground', '15m', 'script', '-q', '-e', '-c',
            "wine cmd /d /c 'C:\\verify.cmd'", str(self.prefix / 'drive_c' / 'codesys-verification.log'),
        ])
        self.assertEqual(calls[1:], [{'wineserver': ['-k']}, {'wineserver': ['-w']}])
        command = (self.prefix / 'drive_c' / 'verify.cmd').read_text()
        self.assertIn('--runscript="C:\\verify.py"', command)
        self.assertEqual(command.splitlines()[-1], 'exit /b %errorlevel%')

    def test_vendor_failure_is_preserved_even_when_old_boot_artifacts_exist(self):
        for extension in ('project', 'app', 'crc'):
            (self.prefix / 'drive_c' / ('codesys-verification.' + extension)).write_text('Old boot artifact')
        result, calls = self.run_verifier(status=5, files={})
        self.assertEqual(result.returncode, 5)
        self.assertEqual(len(calls), 1)

    def test_old_boot_artifacts_cannot_satisfy_a_process_that_skips_verification(self):
        for extension in ('project', 'app', 'crc'):
            (self.prefix / 'drive_c' / ('codesys-verification.' + extension)).write_text('Old boot artifact')
        result, calls = self.run_verifier(files={})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(calls), 1)

    def test_native_signal_assertion_rejects_zero_exit_and_fresh_boot_artifacts(self):
        for ending in ('\r\n', '\r\r\n'):
            with self.subTest(line_ending=ending):
                self.calls.write_text('')
                transcript = ending.join([
                    'assertion failed [x86_avx_state_ptr->xsave_header.xfeatures == kSupportedXFeatureBits]: ',
                    '(ThreadContextSignals.cpp:414 rt_sigreturn)',
                    'Compile complete -- 0 errors, 0 warnings',
                    '',
                ])
                result, calls = self.run_verifier(transcript=transcript)
                self.assertEqual(result.returncode, 1)
                self.assertIn('Wine translation aborted', result.stderr)
                self.assertIn('codesys-verification.log', result.stderr)
                self.assertEqual(len(calls), 1)
                self.assertEqual((self.prefix / 'drive_c' / 'codesys-verification.log').read_bytes().decode(), transcript)

    def test_ordinary_compiler_assertion_text_does_not_match_native_signal_failure(self):
        result, calls = self.run_verifier(transcript='Compiler diagnostic: assertion failed\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 3)

    def test_missing_or_empty_boot_file_rejects_an_apparently_successful_vendor_exit(self):
        for extension in ('project', 'app', 'crc'):
            for content in (None, ''):
                with self.subTest(extension=extension, content=content):
                    for artifact in (self.prefix / 'drive_c').glob('codesys-verification.*'):
                        artifact.unlink()
                    self.calls.write_text('')
                    files = {name: 'Vendor artifact' for name in ('project', 'app', 'crc')}
                    if content is None:
                        del files[extension]
                    else:
                        files[extension] = content
                    result, calls = self.run_verifier(files=files)
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
