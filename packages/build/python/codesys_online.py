"""CODESYS 3.5.22.30 online operations; executed by its IronPython engine."""
from __future__ import print_function

import io
import json
import os
import time
from build import fail_on_errors, import_objects, unique_child
from System import Activator, AppDomain, Array, Enum, Environment, Object
from System.Net import Dns, IPAddress
from System.Reflection import BindingFlags, TargetInvocationException


def core_application(online_application):
    # The shipped scripting wrapper omits Keep from its login switch. Its core
    # application provides a session-only login, which never compiles/downloads.
    # This narrow bridge is pinned to the scripting version in our Docker image.
    kind = online_application.GetType()
    if kind.FullName != '_3S.CoDeSys.ScriptDriverOnline.OnlineApplication' or str(kind.Assembly.GetName().Version) != '4.2.0.0':
        raise RuntimeError('Unsupported CODESYS online scripting implementation')
    prop = kind.GetProperty('Application', BindingFlags.Instance | BindingFlags.NonPublic)
    if prop is None:
        raise RuntimeError('CODESYS session-only application API is unavailable')
    return prop.GetValue(online_application, None)


def loaded_type(name):
    for assembly in AppDomain.CurrentDomain.GetAssemblies():
        kind = assembly.GetType(name, False)
        if kind is not None:
            return kind
    raise RuntimeError('CODESYS API type is unavailable: ' + name)


def session_login(core):
    kind = loaded_type('_3S.CoDeSys.OnlineManager.OnlineApplicationLoginConfiguration')
    config = Activator.CreateInstance(kind)
    mode = loaded_type('_3S.CoDeSys.Core.Online.ApplicationLoginClientModes')
    kind.GetProperty('ClientModes').SetValue(config, Enum.Parse(mode, 'ReadOnly'), None)
    api = loaded_type('_3S.CoDeSys.Core.Online.IOnlineApplication23')
    login = api.GetMethod('Login')
    if not login.Invoke(core, Array[Object]([True, config])):
        raise RuntimeError('The controller does not contain this application')


def controller_ids(core):
    ids = {'codeId': str(core.CodeId), 'dataId': str(core.DataId)}
    if any(value == '00000000-0000-0000-0000-000000000000' for value in ids.values()):
        raise RuntimeError('Controller application has no downloaded code/data identity')
    return ids


def controller_state(core):
    # Login updates IDs synchronously, but ApplicationState is timer-owned.
    # Query the original device's application-list service for a fresh state.
    name_property = core.GetType().GetProperty('ApplicationName', BindingFlags.Instance | BindingFlags.NonPublic)
    name = str(name_property.GetValue(core, None))
    api = loaded_type('_3S.CoDeSys.Core.Online.IOnlineDevice6')
    arguments = Array[Object]([None, None])
    api.GetMethod('ReadApplicationList').Invoke(core.OnlineDevice, arguments)
    names, states = arguments[0], arguments[1]
    if names is None or states is None or len(names) != len(states):
        raise RuntimeError('Controller returned an incomplete application-state list')
    found = [str(states[index]) for index in range(len(names)) if str(names[index]) == name]
    if len(found) != 1 or found[0] == 'unknown':
        raise RuntimeError('Controller application state is unavailable: ' + name)
    return found[0]


def require_current_boot_project(core):
    arguments = Array[Object]([False, False])
    api = loaded_type('_3S.CoDeSys.Core.Online.IOnlineApplication8')
    api.GetMethod('CheckFileConsistency').Invoke(core, arguments)
    if not arguments[0]:
        raise RuntimeError('Controller boot project does not match the downloaded application')


def create_controller_boot_project(core):
    # Reflection retains the CLR stack IronPython otherwise maps to ValueError.
    api = loaded_type('_3S.CoDeSys.Core.Online.IOnlineApplication3')
    try:
        api.GetMethod('CreateBootProject').Invoke(core, None)
    except TargetInvocationException as error:
        cause = error.InnerException if error.InnerException is not None else error
        raise RuntimeError('Controller boot project creation failed:\n' + cause.ToString())


def generate_online_code(application):
    environment = loaded_type('_3S.CoDeSys.ScriptDriverOnline.APEnvironment')
    prop = environment.GetProperty('LanguageModelMgr', BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
    manager = prop.GetValue(None, None)
    if not manager.GenerateCode(application.guid, True, False):
        raise RuntimeError('CODESYS cannot generate an online change for this source')


def consolidated_manager():
    kind = loaded_type('_3S.CoDeSys.LanguageModelManager.LanguageModelManagerConsolidated')
    return kind.GetProperty('_LMM', BindingFlags.Static | BindingFlags.NonPublic).GetValue(None, None)


def context_ids(context):
    if context is None:
        raise RuntimeError('Compiler context is unavailable')
    ids = {'codeId': str(context.CodeId), 'dataId': str(context.DataId)}
    if any(value == '00000000-0000-0000-0000-000000000000' for value in ids.values()):
        raise RuntimeError('Compiler context has no generated code/data identity')
    return ids


def load_downloaded_reference(application):
    # Background reference loading may not have populated the language model
    # when a new headless worker receives its first operation. This original
    # synchronous path reads the candidate's saved compileinfo without building.
    context = consolidated_manager().GetReferenceContextSynchronLoad(application.guid)
    if context is None:
        raise RuntimeError('Downloaded compiler reference could not be loaded')
    return context_ids(context)


def remove_deleted(parent, previous, current):
    """Reconcile only source-owned objects; preserve GUIDs of unchanged objects."""
    new = {item['name'].lower(): item for item in current}
    for old in previous:
        obj = unique_child(parent, old['name'])
        fresh = new.get(old['name'].lower())
        if obj is None:
            raise RuntimeError('Saved source object is missing: ' + old['name'])
        if fresh is None or old['kind'] != fresh['kind'] or bool(old.get('persistent')) != bool(fresh.get('persistent')):
            obj.remove()
        else:
            remove_deleted(obj, old.get('children', []), fresh.get('children', []))


def reconcile(application, previous, current):
    # A folder move changes placement rather than text. Remove/recreate just
    # that moved object, letting the vendor decide whether the update is valid.
    new = {(tuple(item['folder']), item['name'].lower()): item for item in current}
    for old in previous:
        parent = application
        for name in old['folder']:
            parent = unique_child(parent, name)
            if parent is None:
                raise RuntimeError('Saved source folder is missing: ' + name)
        fresh = new.get((tuple(old['folder']), old['name'].lower()))
        remove_deleted(parent, [old], [fresh] if fresh else [])


def run_online(engine, request):
    progress_path = request.get('progress')
    def progress(stage):
        if progress_path:
            with io.open(progress_path, 'a', encoding='utf-8') as output:
                output.write(u'{0}Z {1}\n'.format(time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()), stage))
    progress('Opening project; processor count {0}'.format(Environment.ProcessorCount))
    project = engine.projects.open(request['project'], primary=True)
    application = project.active_application
    online_app = None
    online_device = None
    try:
        progress('Project opened; configuring controller connection')
        if application is None:
            raise RuntimeError('Project has no active Application')
        device = application.parent
        while device is not None and not getattr(device, 'is_device', False):
            device = device.parent
        if device is None:
            raise RuntimeError('Application has no controller device')
        settings = request['online']
        gateway_ip = str(Dns.GetHostAddresses(settings['gateway']['host'])[0])
        device_ip = str(Dns.GetHostAddresses(settings['device']['host'])[0])
        gateway = engine.online.gateways.add_new_gateway('codesys-build', {0: gateway_ip, 1: settings['gateway']['port']})
        device.set_gateway_and_ip_address(gateway.guid, IPAddress.Parse(device_ip), settings['device']['port'])
        credentials = settings.get('credentials')
        if credentials:
            username, password = (os.environ.get(credentials[key]) for key in ('usernameEnv', 'passwordEnv'))
            if not username or not password:
                raise RuntimeError('CODESYS online credential environment variables are required')
            engine.online.set_specific_credentials(device, username, password)
        online_device = engine.online.create_online_device(device)
        if request.get('initializeUser'):
            if request['operation'] != 'download' or not credentials:
                raise RuntimeError('Initial controller user requires an explicit download and credentials')
            online_device.set_credentials_for_initial_user(username, password)
        progress('Controller connection configured')
        previous = request.get('baseline')
        if request['operation'] != 'download':
            online_app = engine.online.create_online_application(application)
            core = core_application(online_app)
            if not previous or str(application.guid) != previous['applicationGuid']:
                raise RuntimeError('Online change requires the saved downloaded application')
            progress('Checking downloaded controller identity and state')
            session_login(core)
            try:
                observed = controller_ids(core)
                if observed != previous['controllerIds']:
                    raise RuntimeError('Controller application differs from the saved baseline; use an explicit download')
                progress('Loading downloaded compiler reference')
                if load_downloaded_reference(application) != observed:
                    raise RuntimeError('Downloaded compiler reference differs from the controller; use an explicit download')
                progress('Downloaded compiler reference loaded')
                state = controller_state(core)
                if request['operation'] == 'online-change' and state != 'run':
                    raise RuntimeError('Online change requires a running application')
                if request['operation'] == 'inspect':
                    return {'applicationGuid': str(application.guid), 'controllerIds': observed,
                            'state': state, 'values': {expression: online_app.read_value(expression) for expression in request.get('read', [])}}
            finally:
                core.Logout()
        if request['operation'] == 'online-change':
            reconcile(application, previous['objects'], request['objects'])
        import_objects(engine, application, request, request['operation'] != 'download', progress)
        if request['symbols'] and not any(getattr(child, 'is_symbol_config', False) for child in application.get_children()):
            from System import Guid
            application.create_symbol_config(True, True, Guid('{0141eb75-141b-4ea1-9a8c-75f952b22a6c}'))
        # Match the normal build's source/template lifecycle. Saving the edited
        # tree and clearing editor-load diagnostics happens before compilation.
        project.save()
        for category in engine.system.get_message_categories():
            engine.system.clear_messages(category)
        if request['operation'] == 'download':
            # A full download replaces the previous compiler model. Use the
            # normal build's clean/rebuild path before opening the online session.
            progress('Rebuilding application for full download')
            application.clean()
            application.rebuild()
            fail_on_errors(engine)
            application.generate_code()
            project.save()
        else:
            # Cleaning would discard the downloaded reference needed to decide
            # whether a source edit can be applied as an online change.
            progress('Building application incrementally for online change')
            application.build()
        fail_on_errors(engine)
        if request['operation'] == 'download':
            online_app = engine.online.create_online_application(application)
            core = core_application(online_app)
            progress('Downloading application')
            online_app.login(engine.OnlineChangeOption.Never, False)
            expected = controller_ids(core)
            if controller_state(core) != 'run':
                online_app.start()
        else:
            # Stay on the session-only/core route. High-level scripting Force
            # still auto-creates absent applications; this route never creates
            # an application and passes True explicitly to the download service.
            progress('Rechecking controller identity before online change')
            if not core.Login(True):
                raise RuntimeError('Controller application disappeared before the online change')
            if controller_ids(core) != previous['controllerIds']:
                raise RuntimeError('Controller application changed before the online change')
            expected = controller_ids(core)
            if not application.is_uptodate:
                if not application.is_online_change_possible:
                    raise RuntimeError('CODESYS requires a full download for this source; online change was refused')
                progress('Generating online-change code')
                generate_online_code(application)
                fail_on_errors(engine)
                expected = context_ids(consolidated_manager().GetCompileContext(application.guid))
                mode = loaded_type('_3S.CoDeSys.Core.Online.BootProjectTransferMode')
                progress('Applying online change')
                core.Download(True, Enum.Parse(mode, 'UseProjectSetting'))
        # An online-change transfer does not itself replace the boot project.
        # The original online boot command saves the downloaded application;
        # Boot-only host preparation saves the accepted application separately
        # from the live transfer; it does not issue a controller full download.
        progress('Saving running application as controller boot project')
        create_controller_boot_project(core)
        require_current_boot_project(core)
        progress('Confirming activated code/data identity with a fresh controller login')
        core.Logout()
        session_login(core)
        if controller_ids(core) != expected:
            raise RuntimeError('Controller did not retain the downloaded code/data identity')
        fail_on_errors(engine)
        ids = controller_ids(core)
        state = controller_state(core)
        if state != 'run':
            raise RuntimeError('Controller is not running after the operation')
        progress('Reading controller values')
        result = {'applicationGuid': str(application.guid), 'controllerIds': ids,
                  'state': state, 'application': application.get_name(),
                  'values': {expression: online_app.read_value(expression) for expression in request.get('read', [])}}
        online_app.logout()
        progress('Saving downloaded project')
        project.save()
        return result
    finally:
        if online_app is not None:
            online_app.Dispose()
        if online_device is not None:
            online_device.Dispose()
        # The original language-model manager joins its asynchronous downloaded
        # reference saver on project close. Publication happens after this returns.
        progress('Closing project and waiting for downloaded reference')
        project.close()
        progress('Project closed')
