"""Verify the installed compiler and its symbol-publishing dependencies offline."""
from __future__ import print_function

try:
    unicode
except NameError:
    unicode = str


def fail_on_errors(engine):
    errors = []
    for category in engine.system.get_message_categories():
        messages = engine.system.get_message_objects(
            category, engine.Severity.Error | engine.Severity.FatalError,
        )
        for message in messages:
            project = getattr(message, 'project', None)
            location = unicode(project.path) if project is not None else unicode(category)
            errors.append(location + ': ' + unicode(message.text))
    if errors:
        raise RuntimeError('CODESYS installation verification failed:\n' + '\n'.join(errors))


def verify(engine):
    from System import Guid

    engine.system.script_prompt_handling = engine.ScriptPromptHandling.LogPrompts
    engine.device_repository.import_device(
        path=r'C:\codesys-device\codesyscontrol.devdesc.xml',
        source=engine.device_repository.sources[0],
        save_device_cache=True,
    )
    path = r'C:\codesys-verification.project'
    project = engine.projects.create(path, primary=True)
    try:
        # This identity belongs to the included Linux ARM64 device description.
        project.add('Device', 4096, '0000 1008', '4.22.0.0')
        application = project.active_application
        if application is None:
            raise RuntimeError('Verification device did not create an Application')
        program = application.create_program('PLC_PRG')
        program.textual_declaration.replace(
            "PROGRAM PLC_PRG\nVAR\n"
            "    {attribute 'symbol' := 'readwrite'}\n"
            "    Counter : UDINT;\nEND_VAR\n"
        )
        program.textual_implementation.replace('Counter := Counter + 1;\n')
        task = application.create_task_configuration().create_task('MainTask')
        task.kind_of_task = engine.KindOfTask.Cyclic
        task.priority = '1'
        task.interval_unit = 'ms'
        task.interval = '20'
        task.pous.add('PLC_PRG')
        application.create_symbol_config(
            True, True, Guid('{0141eb75-141b-4ea1-9a8c-75f952b22a6c}'),
        )
        project.save()
        for category in engine.system.get_message_categories():
            engine.system.clear_messages(category)
        application.clean()
        application.rebuild()
        fail_on_errors(engine)
        application.generate_code()
        fail_on_errors(engine)
        application.create_boot_application(r'C:\codesys-verification.app', True, False)
        fail_on_errors(engine)
        project.save()
        project.close()
        project = None

        # Compilation can succeed before missing transitive libraries are
        # reported. Reopening exercises library resolution on the saved project.
        project = engine.projects.open(path, primary=True)
        project.active_application.get_library_manager().get_libraries(recursive=True)
        engine.system.delay(1000)
        fail_on_errors(engine)
    finally:
        if project is not None:
            project.close()
    print('CODESYS ARM64 compilation, symbol publishing and project reopen: PASS')


if __name__ == '__main__':
    import ctypes
    import scriptengine
    import traceback

    native_exit = ctypes.windll.kernel32.ExitProcess
    try:
        verify(scriptengine)
    except Exception:
        traceback.print_exc()
        native_exit(1)
    native_exit(0)
