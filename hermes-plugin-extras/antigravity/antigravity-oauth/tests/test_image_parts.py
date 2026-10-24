#!/usr/bin/env python3
"""Regression tests: image_url parts must survive OpenAI->Gemini translation.

Background: translate_openai_to_gemini() silently dropped {"type": "image_url"}
parts, so Gemini received text-only messages and confabulated image
descriptions. These tests pin the translated shape:
image parts -> {"inlineData": {"mimeType": ..., "data": ...}} in order.
"""

import pathlib
import sys
import time
import unittest
import importlib.util

PLUGIN_PATH = pathlib.Path(__file__).resolve().parent.parent / "__init__.py"


def load_plugin():
    name = f"antigravity_oauth_test_{time.time_ns()}"
    spec = importlib.util.spec_from_file_location(name, PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class ImagePartsTests(unittest.TestCase):
    def setUp(self):
        self.plugin = load_plugin()

    def test_text_and_image_parts_preserved_in_order(self):
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this image?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + TINY_PNG_B64}},
            ],
        }]
        contents = self.plugin.translate_openai_to_gemini(messages)
        self.assertEqual(len(contents), 1)
        parts = contents[0]["parts"]
        self.assertEqual(parts[0], {"text": "What is in this image?"})
        self.assertEqual(
            parts[1], {"inlineData": {"mimeType": "image/png", "data": TINY_PNG_B64}}
        )

    def test_image_only_message_still_sends_parts(self):
        messages = [{
            "role": "user",
            "content": [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,/9j/AAAA"}}],
        }]
        contents = self.plugin.translate_openai_to_gemini(messages)
        self.assertEqual(len(contents), 1)
        self.assertEqual(
            contents[0]["parts"],
            [{"inlineData": {"mimeType": "image/jpeg", "data": "/9j/AAAA"}}],
        )

    def test_unresolvable_image_does_not_kill_text(self):
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": "hi"},
                {"type": "image_url", "image_url": {"url": ""}},
            ],
        }]
        contents = self.plugin.translate_openai_to_gemini(messages)
        self.assertEqual(len(contents), 1)
        self.assertEqual(contents[0]["parts"], [{"text": "hi"}])


if __name__ == "__main__":
    unittest.main()
