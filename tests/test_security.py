"""Tests for security utilities (URL validation, filename validation, path traversal)."""

import pytest
from fastapi import HTTPException

from app.utils.security import (
    validate_api_url,
    validate_filename,
    get_safe_filepath,
    validate_model_path,
)


class TestValidateApiUrl:

    def test_localhost_allowed(self):
        assert validate_api_url("http://localhost:8000/api/towns/") is True

    def test_127_0_0_1_allowed(self):
        assert validate_api_url("http://127.0.0.1:8000/api/towns/") is True

    def test_subdomain_matches(self):
        assert validate_api_url("http://api.localhost:8000/api/") is True

    def test_external_domain_rejected(self):
        assert validate_api_url("http://evil.com/api/") is False

    def test_empty_url_rejected(self):
        assert validate_api_url("") is False

    def test_no_hostname_rejected(self):
        assert validate_api_url("not-a-url") is False

    def test_partial_domain_match_rejected(self):
        """malicious-localhost.com should NOT match 'localhost'."""
        assert validate_api_url("http://malicious-localhost.com/") is False


class TestValidateFilename:

    def test_clean_filename_passes(self):
        assert validate_filename("town_data.json") == "town_data.json"

    def test_alphanumeric_with_dots_dashes(self):
        assert validate_filename("my-town_v2.json") == "my-town_v2.json"

    def test_path_traversal_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_filename("../etc/passwd")
        assert exc_info.value.status_code == 400

    def test_forward_slash_rejected(self):
        with pytest.raises(HTTPException):
            validate_filename("path/file.json")

    def test_backslash_rejected(self):
        with pytest.raises(HTTPException):
            validate_filename("path\\file.json")

    def test_null_bytes_rejected(self):
        with pytest.raises(HTTPException):
            validate_filename("file\x00.json")

    def test_empty_filename_rejected(self):
        with pytest.raises(HTTPException):
            validate_filename("")

    def test_special_chars_rejected(self):
        with pytest.raises(HTTPException):
            validate_filename("file name.json")  # space

    def test_extension_validation(self):
        assert validate_filename("data.json", [".json"]) == "data.json"
        with pytest.raises(HTTPException):
            validate_filename("data.exe", [".json"])


class TestGetSafeFilepath:

    def test_path_within_base(self, tmp_path):
        result = get_safe_filepath("test.json", str(tmp_path), [".json"])
        assert result.parent == tmp_path
        assert result.name == "test.json"

    def test_traversal_rejected(self, tmp_path):
        with pytest.raises(HTTPException):
            get_safe_filepath("../../etc/passwd", str(tmp_path))


class TestValidateModelPath:

    def test_clean_path(self):
        cat, name = validate_model_path("buildings", "house.glb")
        assert cat == "buildings"
        assert name == "house.glb"

    def test_traversal_in_category_rejected(self):
        with pytest.raises(HTTPException):
            validate_model_path("../etc", "house.glb")

    def test_traversal_in_model_rejected(self):
        with pytest.raises(HTTPException):
            validate_model_path("buildings", "../secret.glb")
