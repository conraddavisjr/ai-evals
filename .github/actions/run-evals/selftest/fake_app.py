"""A stand-in eval route for the action's self-test: answers like an app's
POST /api/eval/generate (contract 1) with no model, keyed off the prompt.
It refuses any request that asks it to keep output, so a test run proves
the action sends persist: false."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = os.environ.get("EVAL_SECRET", "")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.headers.get("authorization") != f"Bearer {SECRET}":
            return self.send(401, {"error": "unauthorized"})
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        if body.get("persist") is not False:
            return self.send(400, {"error": "persist must be false in CI"})
        prompt = str(body.get("prompt", ""))
        base = {
            "contract": 1,
            "steps": [{"name": "classify", "ms": 1}],
            "usage": {"input_tokens": 0, "output_tokens": 0, "usd": 0},
        }
        if "ignore" in prompt.lower() or "please decline" in prompt.lower():
            return self.send(200, {**base, "outcome": "declined", "reason": "injection", "decline_reason": "No.", "recipes": []})
        base["steps"].append({"name": "drafting", "ms": 5})
        base["usage"]["usd"] = 0.001
        return self.send(200, {**base, "outcome": "recipes", "reason": None, "decline_reason": None, "recipes": [{"title": "Leek soup"}]})


HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "8787"))), Handler).serve_forever()
