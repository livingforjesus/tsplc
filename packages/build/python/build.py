"""Runs inside CODESYS's Python engine, not the Mac's Python installation."""
from __future__ import print_function

import io
import json
import os
import re
from decimal import Decimal

try:
	unicode
except NameError:
	unicode = str
import shutil
import time


class CompilerError(RuntimeError):
	def __init__(self, diagnostics):
		self.diagnostics = diagnostics
		RuntimeError.__init__(self, "CODESYS errors:\n" + "\n".join(item["text"] for item in diagnostics))


def diagnostic(message, category):
	metadata_errors = {}
	def field(name, convert=unicode):
		try:
			value = getattr(message, name, None)
			return convert(value) if value is not None else None
		except Exception as error:
			metadata_errors[name] = unicode(error)
			return None
	obj, project = field("object", lambda value: value), field("project", lambda value: value)
	identity, project_path = None, None
	if obj is not None:
		try:
			path, ancestors, parent = [], [], obj
			while parent is not None and not parent.is_root:
				path.insert(0, unicode(parent.get_name()))
				ancestors.insert(0, parent)
				parent = parent.parent
			identity = {"name": unicode(obj.get_name()), "guid": unicode(obj.guid), "path": path, "isApplicationChild": None}
			application = None
			try:
				application = project.active_application if project is not None else None
				if application is not None and obj.parent is not None:
					identity["isApplicationChild"] = bool(obj.parent.guid == application.guid)
			except Exception as error:
				metadata_errors["isApplicationChild"] = unicode(error)
			try:
				if application is not None:
					for index in range(len(ancestors) - 1, -1, -1):
						if ancestors[index].guid == application.guid:
							identity["applicationPath"] = path[index + 1:]
							break
			except Exception as error:
				metadata_errors["applicationPath"] = unicode(error)
		except Exception as error:
			metadata_errors["object"] = unicode(error)
	if project is not None:
		try:
			project_path = unicode(project.path)
		except Exception as error:
			metadata_errors["project"] = unicode(error)
	result = {
		"category": unicode(category), "text": unicode(message.text),
		"severity": field("severity"), "project": project_path, "object": identity,
		# The vendor owns position interpretation. Preserve all bits as a string;
		# consumers use positionText, never decode this opaque integer.
		"position": field("position"), "positionText": field("position_text"),
		# CODESYS exposes .NET short/int values: convert explicitly for json.dumps.
		"positionOffset": field("position_offset", int), "length": field("length", int),
		"prefix": field("prefix"), "number": field("number", int),
	}
	if metadata_errors:
		result["metadataErrors"] = metadata_errors
	return result


def fail_on_errors(engine):
	errors = []
	for category in engine.system.get_message_categories():
		errors.extend(diagnostic(message, category) for message in engine.system.get_message_objects(
			category, engine.Severity.Error | engine.Severity.FatalError,
		))
	if errors:
		raise CompilerError(errors)


def object_key(spec):
	return (spec["kind"], spec["name"], bool(spec.get("persistent")), tuple(spec.get("folder", [])),
		tuple(object_key(child) for child in spec.get("children", [])))


def project_key(request):
	return (request["templateHash"], request["entry"], request["task"],
		tuple(request["removeObjects"]), request["symbols"],
        tuple((item["title"],item["sha256"],item.get("namespace")) for item in request.get("libraries", [])),
		tuple((task["name"], task["intervalNanoseconds"], task["priority"], tuple(task["programs"])) for task in request.get("tasks", [])),
		tuple(object_key(spec) for spec in request["objects"]))


def unique_child(parent, name):
	matches = parent.find_ignore_transient_objects(name, False)
	if len(matches) > 1:
		raise RuntimeError("Ambiguous child " + name)
	return matches[0] if matches else None


def create_object(engine, parent, spec):
	kind, name = spec["kind"], spec["name"]
	if kind == "dut":
		dut_types = {"structure": engine.DutType.Structure, "enumeration": engine.DutType.Enumeration,
			"union": engine.DutType.Union, "alias": engine.DutType.Alias}
		subtype = spec["dutType"]
		# The complete declaration replaces this valid creation placeholder below.
		return parent.create_dut(name, dut_types[subtype], "INT" if subtype == "alias" else None)
	if kind == "gvl":
		return parent.create_persistentvars(name) if spec.get("persistent") else parent.create_gvl(name)
	if kind == "program":
		return parent.create_program(name)
	if kind == "function_block":
		return parent.create_function_block(name)
	if kind == "function":
		# The creation API requires a type even for a no-return function. Importing
		# its complete declaration below replaces this temporary BOOL header.
		return parent.create_function(name, spec.get("returnType", "BOOL"))
	if kind == "interface":
		return parent.create_interface(name)
	if kind == "method":
		return parent.create_method(name, spec.get("returnType"))
	if kind == "property":
		return parent.create_property(name, spec["returnType"])
	if kind == "action":
		return parent.create_action(name)
	if kind in ("get", "set"):
		# CODESYS creates accessors with the property, not with create_method.
		obj = unique_child(parent, name)
		if obj is None:
			raise RuntimeError("Property accessor is missing: " + name)
		return obj
	raise RuntimeError("Unsupported IEC object kind " + kind)


def import_object(engine, parent, spec):
	obj = unique_child(parent, spec["name"])
	if obj is None:
		obj = create_object(engine, parent, spec)
	if spec["kind"] != "action":
		obj.textual_declaration.replace(spec["declaration"])
	if "implementation" in spec:
		obj.textual_implementation.replace(spec["implementation"])
	children = spec.get("children", [])
	if spec["kind"] == "property":
		# Remove default accessors absent from source (e.g. a read-only property).
		names = set(child["name"].lower() for child in children)
		for child in list(obj.get_children()):
			if child.get_name().lower() in ("get", "set") and child.get_name().lower() not in names:
				child.remove()
	for child in children:
		import_object(engine, obj, child)


def install_project_libraries(engine, application, libraries, progress):
	if not libraries:
		return
	import hashlib
	manager = application.get_library_manager()
	# SP22's scripting bridge passes a null repository when the optional argument
	# is omitted. Select the configured first repository explicitly.
	repositories = engine.librarymanager.repositories
	if not repositories:
		raise RuntimeError("No CODESYS library repository is configured")
	for library in libraries:
		progress("Installing library " + library["title"])
		with open(library["path"], "rb") as source:
			if hashlib.sha256(source.read()).hexdigest() != library["sha256"]:
				raise RuntimeError("Library payload hash mismatch: " + library["title"])
		managed = engine.librarymanager.install_library(library["path"], repositories[0], True)
		if managed is None or unicode(managed.title) != library["title"]:
			raise RuntimeError("Library title does not match dependency: " + library["title"])
		for key in ("company", "version"):
			if library.get(key) is not None and unicode(getattr(managed, key)) != library[key]:
				raise RuntimeError("Library " + key + " does not match dependency: " + library["title"])
		matches = []
		for reference in list(manager.references):
			if unicode(reference.name).startswith("#"):
				continue
			existing = reference.managed_library
			if unicode(existing.title) == unicode(managed.title) and unicode(existing.company) == unicode(managed.company):
				matches.append(reference)
		if len(matches) > 1:
			raise RuntimeError("Ambiguous existing library reference: " + library["title"])
		exact = matches and unicode(matches[0].managed_library.version) == unicode(managed.version)
		namespace = library.get("namespace") or (unicode(matches[0].namespace) if matches else None)
		if not exact:
			for reference in matches:
				manager.remove_library(unicode(reference.name))
			manager.add_library(managed)
		refs = [reference for reference in list(manager.references) if not unicode(reference.name).startswith("#")
			and unicode(reference.managed_library.title) == unicode(managed.title)
			and unicode(reference.managed_library.company) == unicode(managed.company)
			and unicode(reference.managed_library.version) == unicode(managed.version)]
		if len(refs) != 1:
			raise RuntimeError("Installed library reference could not be verified: " + library["title"])
		if namespace:
			refs[0].namespace = namespace


def import_objects(engine, application, request, reusing, progress):
	install_project_libraries(engine, application, request.get("libraries", []), progress)
	progress("Importing source objects")
	if not reusing:
		for name in request["removeObjects"]:
			for obj in application.find_ignore_transient_objects(name, True):
				obj.remove()
		# Source objects own their complete subtree, including removed methods.
		for spec in request["objects"]:
			existing = application.find_ignore_transient_objects(spec["name"], True)
			if len(existing) > 1:
				raise RuntimeError("Ambiguous IEC object " + spec["name"])
			for obj in existing:
				obj.remove()
	for spec in request["objects"]:
		parent = application
		for name in spec["folder"]:
			folder = unique_child(parent, name)
			if folder is None:
				# create_folder returns None in CODESYS; resolve the inserted object.
				parent.create_folder(name)
				folder = unique_child(parent, name)
				if folder is None:
					raise RuntimeError("Could not create source folder " + name)
			elif not folder.is_folder:
				raise RuntimeError("Source folder conflicts with IEC object " + name)
			parent = folder
		import_object(engine, parent, spec)
	if "tasks" in request:
		return configure_tasks(engine, application, request["tasks"], request["objects"])
	matches = application.find_ignore_transient_objects(request["task"], True)
	if len(matches) != 1 or not getattr(matches[0], "is_task", False):
		raise RuntimeError("Template must contain one task named " + request["task"])
	task = matches[0]
	# Only this configured task is rewired; its timing and watchdog stay in the template.
	if list(task.pous) == [request["entry"]]:
		return
	# Task calls are transient children. Remove the call objects themselves;
	# ScriptPouObjectList.remove can change its list without removing those objects.
	for call in list(task.get_children()):
		call.remove()
	task.pous.add(request["entry"])
	if list(task.pous) != [request["entry"]]:
		raise RuntimeError("Could not configure the entry task: " + repr(list(task.pous)))

def configure_tasks(engine, application, tasks, objects):
	# An explicit task plan owns the entire schedule in this private project copy.
	# Unspecified tasks are removed so template programs cannot execute implicitly.
	if not tasks:
		raise RuntimeError("Explicit task plan must not be empty")
	available = set(spec["name"] for spec in objects if spec["kind"] == "program")
	names, scheduled = set(), set()
	for spec in tasks:
		name = spec["name"].lower()
		ns, priority = int(spec["intervalNanoseconds"]), spec["priority"]
		if name in names or not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", spec["name"]):
			raise RuntimeError("Invalid or duplicate task name " + spec["name"])
		names.add(name)
		if ns <= 0 or ns % 1000000 or ns > 4294967295000000 or isinstance(priority, bool) or not isinstance(priority, int) or not 0 <= priority <= 31:
			raise RuntimeError("Invalid cyclic interval or priority for " + spec["name"])
		if not spec["programs"]:
			raise RuntimeError("Task must schedule at least one PROGRAM: " + spec["name"])
		for program in spec["programs"]:
			if program not in available or program.lower() in scheduled:
				raise RuntimeError("Missing or multiply scheduled source PROGRAM " + program)
			scheduled.add(program.lower())
	configurations = [child for child in application.get_children() if getattr(child, "is_task_configuration", False)]
	if len(configurations) > 1:
		raise RuntimeError("Application contains ambiguous task configurations")
	configuration = configurations[0] if configurations else application.create_task_configuration()
	for child in list(configuration.get_children()):
		if getattr(child, "is_task", False) and child.get_name().lower() not in names:
			child.remove()
	for spec in tasks:
		matches = application.find_ignore_transient_objects(spec["name"], True)
		if len(matches) > 1 or matches and not getattr(matches[0], "is_task", False):
			raise RuntimeError("Ambiguous or conflicting task name " + spec["name"])
		task = matches[0] if matches else configuration.create_task(spec["name"])
		if task.kind_of_task != engine.KindOfTask.Cyclic:
			task.kind_of_task = engine.KindOfTask.Cyclic
		if str(task.priority) != str(spec["priority"]):
			task.priority = str(spec["priority"])
		if str(task.interval_unit).lower() != "ms":
			task.interval_unit = "ms"
		milliseconds = str(int(spec["intervalNanoseconds"]) // 1000000)
		current = str(task.interval).strip()
		match = re.match(r"^(?:T|TIME)#([0-9]+(?:\.[0-9]+)?)MS$", current, re.I)
		if not match or Decimal(match.group(1)) != Decimal(milliseconds):
			task.interval = milliseconds
		# Preserve call-object GUIDs across source-only online changes.
		if list(task.pous) != spec["programs"]:
			for call in list(task.get_children()):
				call.remove()
			for program in spec["programs"]:
				task.pous.add(program)
		observed = str(task.interval).strip()
		match = re.match(r"^(?:T|TIME)#([0-9]+(?:\.[0-9]+)?)MS$", observed, re.I)
		interval = Decimal(match.group(1) if match else observed)
		if task.kind_of_task != engine.KindOfTask.Cyclic or int(task.priority) != spec["priority"] or str(task.interval_unit).lower() != "ms" or interval != Decimal(milliseconds) or list(task.pous) != spec["programs"]:
			raise RuntimeError("Task configuration readback differs for {0}: {1}, {2}, {3}, {4}".format(spec["name"], task.priority, task.interval, task.interval_unit, list(task.pous)))
	actual = [child.get_name().lower() for child in configuration.get_children() if getattr(child, "is_task", False)]
	if set(actual) != names or len(actual) != len(names):
		raise RuntimeError("Unplanned or duplicate tasks remain in the application")
	return tasks


def build(engine, request, loaded, workspace):
	progress_path = os.path.join(os.path.dirname(request["receipt"]), "progress.log")

	def progress(stage):
		with io.open(progress_path, "a", encoding="utf-8") as log:
			log.write(u"{0}Z {1}\n".format(
				time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), stage,
			))

	# Reopen when the template or object membership changes, so removed/renamed
	# declarations cannot survive from an earlier build. Text changes are imported below.
	key = project_key(request)
	reusing = loaded.get("key") == key
	project = None
	try:
		if reusing:
			progress("Reusing loaded project")
			project = loaded["project"]
		else:
			if loaded.get("project") is not None:
				loaded["project"].close()
			loaded.clear()
			progress("Opening project")
			project = engine.projects.open(request["template"], primary=True)
			working = os.path.join(workspace, "project")
			if os.path.isdir(working):
				shutil.rmtree(working)
			os.mkdir(working)
			project.save_as(os.path.join(working, "Application.project"))
		loaded.clear()
		application = project.active_application
		if application is None:
			raise RuntimeError("Template must have an active Application")
		configured_tasks = import_objects(engine, application, request, reusing, progress)
		if request["symbols"] and not any(
			getattr(child, "is_symbol_config", False)
			for child in application.get_children()
		):
			from System import Guid
			application.create_symbol_config(True, True, Guid("{0141eb75-141b-4ea1-9a8c-75f952b22a6c}"))
		progress("Saving generated project")
		project.save()
		progress("Clearing previous diagnostics")
		# Check diagnostics from this compilation, not cached editor-load messages.
		for category in engine.system.get_message_categories():
			engine.system.clear_messages(category)
		progress("Rebuilding application")
		application.clean()
		application.rebuild()
		fail_on_errors(engine)
		progress("Generating application code")
		application.generate_code()
		fail_on_errors(engine)
		project.save()
		# Keep the open file private to the worker; the published project can be
		# opened interactively without conflicting with this persistent compiler.
		shutil.copyfile(project.path, request["project"])
		progress("Exporting boot application")
		application.create_boot_application(request["output"], False, False)
		fail_on_errors(engine)
		if not os.path.isfile(request["output"]) or os.path.getsize(request["output"]) == 0:
			raise RuntimeError("Compiler did not produce a non-empty boot application")
		progress("Build complete")
		with io.open(request["receipt"], "w", encoding="utf-8") as receipt:
			receipt.write(json.dumps(
				dict({"mode": request["mode"], "application": application.get_name()}, **({"tasks": configured_tasks} if configured_tasks is not None else {})),
				ensure_ascii=False,
			))
		loaded.update({"key": key, "project": project})
	except Exception:
		loaded.clear()
		if project is not None:
			# Never retain a partially imported/compiled project after failure.
			try:
				if os.path.normcase(project.path) != os.path.normcase(request["template"]):
					project.save()
					shutil.copyfile(project.path, request["project"])
			except Exception:
				print("Could not save the diagnostic project")
			finally:
				project.close()
		raise
