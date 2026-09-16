"""Canonical rendering and the fingerprint over it."""

import unittest

from layover.document.digest import canonical_json, check_no_floats, digest_of, short_digest
from layover.errors import DocumentError


class NoFloatsTest(unittest.TestCase):
    def test_a_plain_structure_passes(self):
        check_no_floats({"a": [1, 2, {"b": "c"}], "d": None})

    def test_a_float_is_refused(self):
        with self.assertRaises(DocumentError):
            check_no_floats({"a": 1.5})

    def test_a_float_in_a_list_is_refused(self):
        with self.assertRaises(DocumentError):
            check_no_floats({"a": [1, 2.5]})

    def test_a_float_deep_down_is_refused(self):
        with self.assertRaises(DocumentError):
            check_no_floats({"a": {"b": [{"c": 0.1}]}})

    def test_the_message_names_the_place(self):
        with self.assertRaises(DocumentError) as caught:
            check_no_floats({"a": {"b": 1.5}})
        self.assertIn("a.b", str(caught.exception))

    def test_a_key_that_is_not_text_is_refused(self):
        with self.assertRaises(DocumentError):
            check_no_floats({1: "a"})

    def test_a_bool_is_allowed(self):
        check_no_floats({"a": True})


class CanonicalTest(unittest.TestCase):
    def test_keys_come_out_sorted(self):
        self.assertEqual(canonical_json({"b": 1, "a": 2}), '{"a":2,"b":1}')

    def test_there_is_no_incidental_space(self):
        self.assertNotIn(" ", canonical_json({"a": [1, 2]}))

    def test_the_order_written_does_not_matter(self):
        self.assertEqual(canonical_json({"a": 1, "b": 2}), canonical_json({"b": 2, "a": 1}))

    def test_text_is_kept_as_it_is(self):
        self.assertIn("Hauptbahnhof", canonical_json({"name": "Hauptbahnhof"}))

    def test_a_float_is_refused(self):
        with self.assertRaises(DocumentError):
            canonical_json({"a": 1.5})


class DigestTest(unittest.TestCase):
    def test_the_digest_is_hex(self):
        digest = digest_of({"a": 1})
        self.assertEqual(len(digest), 64)
        self.assertTrue(all(character in "0123456789abcdef" for character in digest))

    def test_the_same_document_digests_the_same(self):
        self.assertEqual(digest_of({"a": 1, "b": 2}), digest_of({"b": 2, "a": 1}))

    def test_a_different_document_digests_differently(self):
        self.assertNotEqual(digest_of({"a": 1}), digest_of({"a": 2}))

    def test_a_short_digest_is_the_start_of_the_long_one(self):
        document = {"a": 1}
        self.assertTrue(digest_of(document).startswith(short_digest(document)))

    def test_a_short_digest_has_the_length_asked_for(self):
        self.assertEqual(len(short_digest({"a": 1}, 8)), 8)

    def test_too_short_a_digest_is_refused(self):
        with self.assertRaises(DocumentError):
            short_digest({"a": 1}, 2)

    def test_too_long_a_digest_is_refused(self):
        with self.assertRaises(DocumentError):
            short_digest({"a": 1}, 100)


if __name__ == "__main__":
    unittest.main()
