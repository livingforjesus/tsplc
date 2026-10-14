import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from decimal import Decimal
from build import CompilerError, build, diagnostic


class Calls(list):
	def __init__(self, task):
		self.task = task
		super().__init__(child.name for child in task.children)
	def add(self, name):
		self.task.create(name, "task_call")


class Node:
	def __init__(self, name, kind, parent=None):
		self.name, self.kind, self.parent = name, kind, parent
		self.children = []
		self.declaration, self.implementation = "", ""
		self.textual_declaration = SimpleNamespace(replace=lambda text: setattr(self, "declaration", text))
		self.textual_implementation = SimpleNamespace(replace=lambda text: setattr(self, "implementation", text))
		self.is_folder = kind == "folder"
		self.is_task = kind == "task"
		self.is_task_configuration = kind == "task_configuration"
		self.is_symbol_config = kind == "symbols"
		if self.is_task:
			self.kind_of_task, self.priority, self.interval, self.interval_unit = 1, "1", "20", "ms"
			self.create("PLC_PRG", "task_call")
	@property
	def pous(self):
		# Match the engine: list.remove changes the snapshot, not the task tree.
		return Calls(self)
	@property
	def calls(self):
		return [child.name for child in self.children]

	def get_name(self):
		return self.name
	def get_children(self):
		return self.children
	def remove(self):
		self.parent.children.remove(self)
	def find_ignore_transient_objects(self, name, recursive):
		matches = [child for child in self.children if child.kind != "task_call" and child.name.lower() == name.lower()]
		if recursive:
			for child in self.children:
				matches.extend(child.find_ignore_transient_objects(name, True))
		return matches
	def create(self, name, kind):
		child = Node(name, kind, self)
		self.children.append(child)
		return child
	def create_task_configuration(self): return self.create("Task Configuration", "task_configuration")
	def create_task(self, name): return self.create(name, "task")
	def create_folder(self, name):
		self.create(name, "folder")
	def create_program(self, name): return self.create(name, "program")
	def create_function_block(self, name): return self.create(name, "function_block")
	def create_function(self, name, return_type): return self.create(name, "function")
	def create_gvl(self, name): return self.create(name, "gvl")
	def create_dut(self, name, kind, base): return self.create(name, kind)
	def create_interface(self, name): return self.create(name, "interface")
	def create_method(self, name, return_type): return self.create(name, "method")
	def create_action(self, name): return self.create(name, "action")
	def create_property(self, name, return_type):
		prop = self.create(name, "property")
		prop.create("Get", "get")
		prop.create("Set", "set")
		return prop


class CompilerFixture:
	def __init__(self):
		self.opened = []
		self.fail_compile = False
		self.empty_output = False
		self.engine = SimpleNamespace(
			projects=SimpleNamespace(open=self.open),
			DutType=SimpleNamespace(Structure="structure", Enumeration="enumeration", Union="union", Alias="alias"),
			Severity=SimpleNamespace(Error=1, FatalError=2),
			KindOfTask=SimpleNamespace(Cyclic=1),
			system=SimpleNamespace(get_message_categories=lambda: ["compiler"], get_message_objects=lambda category, severity: [], clear_messages=Mock()),
		)
	def open(self, path, primary):
		app = Node("Application", "application")
		configuration = app.create_task_configuration()
		configuration.create_task("MainTask")
		background = configuration.create_task("BackgroundTask")
		background.children.clear()
		background.pous.add("Monitor")
		app.create("Monitor", "program")
		app.create("Symbols", "symbols")
		app.create("PLC_PRG", "program")
		project = SimpleNamespace(path=path, close=Mock(), active_application=app)
		def save(): Path(project.path).write_text("compiled project")
		def save_as(destination):
			project.path = destination
			save()
		def rebuild():
			if self.fail_compile: raise RuntimeError("Fixture compiler error")
		def export(destination, update, compact):
			Path(destination).write_text("" if self.empty_output else "boot application")
		project.save, project.save_as = save, save_as
		app.clean, app.rebuild, app.generate_code = Mock(), rebuild, Mock()
		app.create_boot_application = export
		self.opened.append(project)
		return project


def spec(kind, name, children=None, folder=None, **kwargs):
	return dict(kind=kind, name=name, declaration="source " + name, children=children or [], folder=folder or [], **kwargs)


class BuildTests(unittest.TestCase):
	def setUp(self):
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.root = Path(self.temp.name)
		self.template = self.root / "Template.project"
		self.template.write_text("original template")
		self.compiler = CompilerFixture()
		self.loaded = {}
		self.counter = 0
		self.objects = [spec("program", "Main", implementation="RETURN;")]
	def request(self, **overrides):
		self.counter += 1
		run = self.root / str(self.counter)
		run.mkdir()
		request = dict(template=str(self.template), templateHash=hashlib.sha256(self.template.read_bytes()).hexdigest(),
			project=str(run / "Application.project"), output=str(run / "Application.app"), receipt=str(run / "compiled.json"),
			objects=self.objects, entry="Main", task="MainTask", symbols=False, removeObjects=["PLC_PRG"], mode="build")
		request.update(overrides)
		return request
	def run_build(self, **overrides):
		request = self.request(**overrides)
		build(self.compiler.engine, request, self.loaded, str(self.root))
		return request
	def find(self, name):
		return self.loaded["project"].active_application.find_ignore_transient_objects(name, True)[0]
	def test_imports_program_and_rewires_only_the_configured_task(self):
		request = self.run_build()
		self.assertEqual(self.find("Main").implementation, "RETURN;")
		self.assertEqual(self.find("MainTask").calls, ["Main"])
		self.assertEqual(self.find("BackgroundTask").calls, ["Monitor"])
		self.assertTrue(Path(request["receipt"]).exists())
		self.assertEqual(self.template.read_text(), "original template")
	def test_explicit_tasks_replace_the_complete_schedule_and_preserve_program_order(self):
		self.objects.append(spec("program", "Second", implementation="RETURN;"))
		tasks = [dict(name="MainTask", intervalNanoseconds="10000000", priority=0, programs=["Second", "Main"])]
		request = self.run_build(tasks=tasks)
		task = self.find("MainTask")
		self.assertEqual((task.kind_of_task, task.interval, task.interval_unit, task.priority), (1, "10", "ms", "0"))
		self.assertEqual(task.calls, ["Second", "Main"])
		self.assertEqual(self.loaded["project"].active_application.find_ignore_transient_objects("BackgroundTask", True), [])
		self.assertEqual(json.loads(Path(request["receipt"]).read_text())["tasks"], tasks)
	def test_creates_missing_tasks_and_reloads_for_schedule_changes(self):
		self.objects.append(spec("program", "Second", implementation="RETURN;"))
		tasks = [dict(name="FastTask", intervalNanoseconds="10000000", priority=1, programs=["Main"]),
			dict(name="SlowTask", intervalNanoseconds="40000000", priority=31, programs=["Second"])]
		self.run_build(tasks=tasks)
		self.assertEqual(self.find("FastTask").calls, ["Main"])
		self.assertEqual(self.find("SlowTask").interval, "40")
		self.objects[0]["implementation"] = "Changed();"
		self.run_build(tasks=tasks)
		self.assertEqual(len(self.compiler.opened), 1)
		tasks[0]["intervalNanoseconds"] = "20000000"
		self.run_build(tasks=tasks)
		self.assertEqual(len(self.compiler.opened), 2)
		tasks[0]["priority"] = 2
		self.run_build(tasks=tasks)
		self.assertEqual(len(self.compiler.opened), 3)
		tasks[0]["programs"], tasks[1]["programs"] = ["Second"], ["Main"]
		self.run_build(tasks=tasks)
		self.assertEqual(len(self.compiler.opened), 4)
	def test_explicit_tasks_reject_invalid_or_missing_programs(self):
		for changes in [dict(intervalNanoseconds="1"), dict(intervalNanoseconds="4294967296000000"), dict(priority=32), dict(programs=[]), dict(programs=["Monitor"]), dict(programs=["Main", "Main"])]:
			task = dict(name="MainTask", intervalNanoseconds="20000000", priority=1, programs=["Main"])
			task.update(changes)
			with self.subTest(changes=changes), self.assertRaises(RuntimeError):
				self.run_build(tasks=[task])
	def test_failed_task_call_readback_discards_the_build(self):
		open_project = self.compiler.open
		def broken_open(path, primary):
			project = open_project(path, primary)
			task = project.active_application.find_ignore_transient_objects("MainTask", True)[0]
			task.create = Mock()
			return project
		self.compiler.engine.projects.open = broken_open
		with self.assertRaisesRegex(RuntimeError, "readback differs"):
			self.run_build(tasks=[dict(name="MainTask", intervalNanoseconds="20000000", priority=1, programs=["Main"])])
		self.assertEqual(self.loaded, {})
	def test_unspecified_template_tasks_cannot_survive_failed_removal(self):
		open_project = self.compiler.open
		def broken_open(path, primary):
			project = open_project(path, primary)
			project.active_application.find_ignore_transient_objects("BackgroundTask", True)[0].remove = Mock()
			return project
		self.compiler.engine.projects.open = broken_open
		with self.assertRaisesRegex(RuntimeError, "Unplanned or duplicate tasks"):
			self.run_build(tasks=[dict(name="MainTask", intervalNanoseconds="20000000", priority=1, programs=["Main"])])
	def test_reuses_the_loaded_project_for_text_changes(self):
		self.run_build()
		self.objects[0]["implementation"] = "NewBody();"
		self.run_build()
		self.assertEqual(len(self.compiler.opened), 1)
		self.assertEqual(self.find("Main").implementation, "NewBody();")
	def test_reloads_for_template_changes(self):
		self.run_build()
		self.template.write_text("changed template")
		self.run_build()
		self.assertEqual(len(self.compiler.opened), 2)
		self.assertEqual(self.compiler.opened[0].path, self.compiler.opened[1].path)
		self.compiler.opened[0].close.assert_called_once()
		self.assertEqual([p.name for p in self.root.glob("project*")], ["project"])
	def test_reloads_for_removed_children_and_moved_domains(self):
		block = spec("function_block", "FB_Test", [spec("method", "Run", implementation="RETURN;")], ["old"], implementation="")
		self.objects.append(block)
		self.run_build()
		block["children"] = []
		block["folder"] = ["new", "nested"]
		self.run_build()
		self.assertEqual(len(self.compiler.opened), 2)
		self.assertEqual(self.find("FB_Test").children, [])
		self.assertEqual(self.find("FB_Test").parent.name, "nested")
	def test_imports_every_supported_object_kind(self):
		self.objects.extend([
			spec("dut", "ST_Data", dutType="structure"), spec("dut", "E_State", dutType="enumeration"),
			spec("dut", "U_Data", dutType="union"), spec("dut", "T_Count", dutType="alias"),
			spec("gvl", "Globals"), spec("function", "F_Add", returnType="INT", implementation="F_Add := 1;"),
			spec("function", "F_NoReturn", implementation="RETURN;"),
			spec("interface", "I_Test", [spec("method", "Run")]),
			spec("function_block", "FB_Test", [spec("action", "Reset", implementation="X := 0;"),
				spec("property", "Ready", [spec("get", "Get", implementation="Ready := TRUE;")], returnType="BOOL")], implementation=""),
		])
		self.run_build()
		self.assertEqual(self.find("Ready").children[0].implementation, "Ready := TRUE;")
		self.assertEqual([child.name for child in self.find("Ready").children], ["Get"])
		self.assertEqual(self.find("Reset").implementation, "X := 0;")
		self.assertEqual(self.find("T_Count").kind, "alias")
		self.assertEqual(self.find("F_NoReturn").implementation, "RETURN;")
	def test_reports_missing_task_instead_of_leaving_entry_unscheduled(self):
		with self.assertRaisesRegex(RuntimeError, "one task named Missing"):
			self.run_build(task="Missing")
	def test_discards_a_failed_project_and_recovers_on_the_next_build(self):
		self.compiler.fail_compile = True
		request = self.request()
		with self.assertRaisesRegex(RuntimeError, "Fixture compiler error"):
			build(self.compiler.engine, request, self.loaded, str(self.root))
		self.assertEqual(self.loaded, {})
		self.assertFalse(Path(request["receipt"]).exists())
		self.compiler.opened[0].close.assert_called_once()
		self.compiler.fail_compile = False
		self.run_build()
		self.assertEqual(len(self.compiler.opened), 2)
	def test_rejects_empty_boot_application(self):
		self.compiler.empty_output = True
		with self.assertRaisesRegex(RuntimeError, "non-empty boot application"):
			self.run_build()
	def test_clears_old_diagnostics_before_compilation(self):
		self.run_build()
		self.compiler.engine.system.clear_messages.assert_called_once_with("compiler")
	def test_fails_on_compiler_error_diagnostics(self):
		self.compiler.engine.system.get_message_objects = lambda category, severity: [SimpleNamespace(text="Unresolved identifier")]
		with self.assertRaisesRegex(RuntimeError, "Unresolved identifier"):
			self.run_build()

	def test_preserves_compiler_position_metadata_without_decoding(self):
		project = SimpleNamespace(path="C:\\scratch\\Application.project", is_root=True, active_application=None)
		folder = SimpleNamespace(get_name=lambda: "Functions", is_root=False, parent=project)
		obj = SimpleNamespace(get_name=lambda: "Main", guid="object-guid", is_root=False, parent=folder)
		message = SimpleNamespace(text="Unresolved identifier", severity="Error", project=project, object=obj,
			position=18446744073709551615, position_text="(Impl) Line 2", position_offset=Decimal(7),
			length=Decimal(4), prefix="C", number=Decimal(46))
		self.compiler.engine.system.get_message_objects = lambda category, severity: [message, SimpleNamespace(text="No position")]
		with self.assertRaises(CompilerError) as failure:
			self.run_build()
		diagnostics = failure.exception.diagnostics
		self.assertEqual(diagnostics[0], dict(category="compiler", text="Unresolved identifier", severity="Error",
			project=project.path, object=dict(name="Main", guid="object-guid", path=["Functions", "Main"], isApplicationChild=None),
			position="18446744073709551615", positionText="(Impl) Line 2", positionOffset=7, length=4, prefix="C", number=46))
		self.assertIsNone(diagnostics[1]["object"])
		self.assertIsNone(diagnostics[1]["positionText"])

	def test_inaccessible_position_context_cannot_mask_compiler_error(self):
		class RemovedObject(object):
			@property
			def is_root(self): raise RuntimeError("Object removed")
		class ClosedProject(object):
			@property
			def path(self): raise RuntimeError("Project closed")
		message = SimpleNamespace(text="Original compiler error", object=RemovedObject(), project=ClosedProject(),
			position_text="Unrecognized vendor position", position=12)
		result = diagnostic(message, "compiler")
		self.assertEqual(result["text"], "Original compiler error")
		self.assertEqual(result["positionText"], "Unrecognized vendor position")
		self.assertIsNone(result["object"])
		self.assertIsNone(result["project"])
		self.assertEqual(result["metadataErrors"], {"object": "Object removed", "project": "Project closed"})

	def test_verifies_application_parent_by_guid_instead_of_name(self):
		application = SimpleNamespace(guid="application-guid", get_name=lambda: "CustomApplication", is_root=False, parent=SimpleNamespace(is_root=True))
		project = SimpleNamespace(path="private.project", active_application=application)
		obj = SimpleNamespace(get_name=lambda: "Main", guid="program-guid", is_root=False, parent=application)
		message = SimpleNamespace(text="Compiler error", object=obj, project=project)
		identity = diagnostic(message, "compiler")["object"]
		self.assertTrue(identity["isApplicationChild"])
		self.assertEqual(identity["applicationPath"], ["Main"])
		obj.parent = SimpleNamespace(guid="template-folder-guid", get_name=lambda: "CustomApplication", is_root=False, parent=application)
		identity = diagnostic(message, "compiler")["object"]
		self.assertFalse(identity["isApplicationChild"])
		self.assertEqual(identity["applicationPath"], ["CustomApplication", "Main"])

	def test_preserves_verified_application_relative_paths_for_nested_pous_and_duts(self):
		project = SimpleNamespace(path="private.project", is_root=True)
		device = SimpleNamespace(guid="device-guid", get_name=lambda: "Device", is_root=False, parent=project)
		application = SimpleNamespace(guid="application-guid", get_name=lambda: "CustomApplication", is_root=False, parent=device)
		project.active_application = application
		controls = SimpleNamespace(guid="controls-guid", get_name=lambda: "controls", is_root=False, parent=application)
		folder = SimpleNamespace(guid="folder-guid", get_name=lambda: "pumps", is_root=False, parent=controls)
		for name in ("F_Pump", "T_Pump"):
			obj = SimpleNamespace(guid=name + "-guid", get_name=lambda: name, is_root=False, parent=folder)
			message = SimpleNamespace(text="Original compiler error", object=obj, project=project)
			identity = diagnostic(message, "compiler")["object"]
			self.assertEqual(identity["path"], ["Device", "CustomApplication", "controls", "pumps", name])
			self.assertEqual(identity["applicationPath"], ["controls", "pumps", name])
			self.assertFalse(identity["isApplicationChild"])

	def test_same_named_other_application_has_no_verified_relative_identity(self):
		project = SimpleNamespace(path="private.project", is_root=True)
		application = SimpleNamespace(guid="active-guid", get_name=lambda: "Application", is_root=False, parent=project)
		other = SimpleNamespace(guid="other-guid", get_name=lambda: "Application", is_root=False, parent=project)
		project.active_application = application
		folder = SimpleNamespace(guid="folder-guid", get_name=lambda: "controls", is_root=False, parent=other)
		obj = SimpleNamespace(guid="program-guid", get_name=lambda: "Main", is_root=False, parent=folder)
		identity = diagnostic(SimpleNamespace(text="Compiler error", object=obj, project=project), "compiler")["object"]
		self.assertEqual(identity["path"], ["Application", "controls", "Main"])
		self.assertFalse(identity["isApplicationChild"])
		self.assertNotIn("applicationPath", identity)


if __name__ == "__main__":
	unittest.main()
