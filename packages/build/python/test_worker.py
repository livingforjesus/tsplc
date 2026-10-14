import builtins
import contextlib
import io
import json
import os
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from build import CompilerError
from worker import serve


class WorkerTests(unittest.TestCase):
	def run_worker(self, actions, compile):
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary)
			session = root / "build" / ".codesys" / "worker"
			session.mkdir(parents=True)
			commands = []
			for index, action in enumerate(actions + ["stop"]):
				command = {"id": str(index), "action": action}
				if action == "build":
					output = session.parent / "build"
					output.mkdir(exist_ok=True)
					(output / "request.json").write_text(json.dumps({
						"mode": "build", "objects": [], "project": "FrameAssembly.project",
						
						"output": "runtime/Application.app", "receipt": "compiled.json",
						"template": "Template.project", "templateHash": "template-fixture",
					}))
				commands.append(command)
			pending = iter(commands)
			def wait(milliseconds):
				(session / "request.json").write_text(json.dumps(next(pending)))
			engine = SimpleNamespace(system=SimpleNamespace(delay=wait))
			with patch("worker.build", side_effect=compile):
				serve(engine, str(session))
			responses = [json.loads((session / (command["id"] + ".json")).read_text()) for command in commands]
			errors = [path.read_text() for path in (session.parent / "build").glob("error.txt")]
			return responses, errors

	def test_handles_multiple_builds_and_health_checks_without_exiting(self):
		requests = []
		def compile(engine, request, loaded, workspace):
			requests.append(request)
		responses, errors = self.run_worker(["ping", "build", "ping", "build"], compile)
		self.assertTrue(all(response["ok"] for response in responses))
		self.assertEqual(errors, [])
		self.assertEqual(len(requests), 2)
		self.assertEqual(requests[0]["project"], requests[1]["project"])
		for request in requests:
			project = Path(request["project"])
			self.assertTrue(project.is_absolute())
			self.assertEqual(Path(request["template"]).parent, project.parent)
			self.assertEqual(Path(request["output"]).parent.parent, project.parent)

	def test_reports_a_failed_build_and_processes_the_next_request(self):
		failure = "Fixture compiler failure after writing a receipt"
		requests = []
		def compile(engine, request, loaded, workspace):
			requests.append(request)
			if len(requests) == 1:
				Path(request["receipt"]).write_text(json.dumps({"mode": "build"}))
				raise RuntimeError(failure)
		responses, errors = self.run_worker(["build", "build"], compile)
		self.assertFalse(responses[0]["ok"])
		self.assertIn(failure, responses[0]["error"])
		self.assertTrue(responses[1]["ok"])
		self.assertTrue(responses[2]["ok"])
		self.assertEqual(len(errors), 1)
		self.assertIn(failure, errors[0])

	def test_preserves_structured_compiler_diagnostics_in_failure_response(self):
		diagnostics = [{"text": "Invalid type", "position": "18446744073709551615", "positionText": "vendor context", "object": None}]
		def compile(engine, request, loaded, workspace):
			raise CompilerError(diagnostics)
		responses, errors = self.run_worker(["build", "ping"], compile)
		self.assertEqual(responses[0]["diagnostics"], diagnostics)
		self.assertIn("Invalid type", responses[0]["error"])
		self.assertTrue(responses[1]["ok"])
		self.assertIn("Invalid type", errors[0])


class WorkerMainTests(unittest.TestCase):
	def test_native_exit_is_preloaded_before_serving_and_preserves_success_and_failure(self):
		worker_path = Path(__file__).with_name("worker.py").resolve()
		for native in (True, False):
			for invalid in (True, False):
				with self.subTest(native=native, invalid=invalid), tempfile.TemporaryDirectory() as temporary:
					root = Path(temporary)
					(root / "request.json").write_text("{invalid" if invalid else json.dumps({"id": "stop", "action": "stop"}))
					phase = "startup"
					events = []
					def exited(api, code):
						events.append((api, phase, code))
						raise SystemExit(code)
					class NativeLibrary:
						@property
						def ExitProcess(self):
							events.append(("bind", phase))
							return lambda code: exited("native", code)
					ctypes = SimpleNamespace(windll=SimpleNamespace(kernel32=NativeLibrary()))
					engine = SimpleNamespace(
						system=SimpleNamespace(exit=lambda code: exited("scriptengine", code)),
						ScriptPromptHandling=SimpleNamespace(LogPrompts="LogPrompts"))
					actual_import = builtins.__import__
					def imported(name, *args, **kwargs):
						if name == "ctypes":
							events.append(("import", phase))
							return ctypes
						return actual_import(name, *args, **kwargs)
					def profiled(frame, event, _argument):
						nonlocal phase
						if frame.f_code.co_filename == str(worker_path) and frame.f_code.co_name == "serve":
							if event == "call": phase = "serving"
							elif event == "return": phase = "after-serve"
					previous_profile = sys.getprofile()
					previous_path = list(sys.path)
					try:
						with patch.dict(sys.modules, {"scriptengine": engine}), patch.dict(os.environ, {
							"CODESYS_BUILD_SESSION": str(root), "CODESYS_BUILD_NATIVE_EXIT": str(native).lower(),
						}), patch("builtins.__import__", side_effect=imported), contextlib.redirect_stderr(io.StringIO()):
							sys.setprofile(profiled)
							with self.assertRaises(SystemExit) as result:
								runpy.run_path(str(worker_path), run_name="__main__")
					finally:
						sys.setprofile(previous_profile)
						sys.path[:] = previous_path
					self.assertEqual(result.exception.code, int(invalid))
					self.assertEqual(events, ([
						("import", "startup"), ("bind", "startup"), ("native", "after-serve", int(invalid)),
					] if native else [("scriptengine", "after-serve", int(invalid))]))
					if not invalid:
						self.assertEqual(json.loads((root / "stop.json").read_text()), {"id": "stop", "ok": True})


if __name__ == "__main__":
	unittest.main()
