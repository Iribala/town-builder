"""Tests for security utilities (URL validation, filename validation, path traversal)."""

import pytest
from fastapi import HTTPException

from app.utils.security import (
    validate_api_url,
    validate_proxy_path,
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


class TestValidateProxyPath:
    """Tests for proxy path validation (SSRF prevention).

    These paths mirror what kibigia sends through the proxy:
    - "" (root list)
    - "42/" (town detail)
    - "42/layout/" (nested resource)
    - "?name=Springfield" (query params are in params, not path)
    """

    def test_empty_path(self):
        assert validate_proxy_path("") == ""

    def test_numeric_id_path(self):
        """Standard kibigia path: /api/proxy/towns/42/."""
        assert validate_proxy_path("42/") == "42/"

    def test_leading_slash_stripped(self):
        assert validate_proxy_path("/42/") == "42/"

    def test_nested_path(self):
        assert validate_proxy_path("42/layout/") == "42/layout/"

    def test_scheme_rejected(self):
        with pytest.raises(ValueError, match="scheme"):
            validate_proxy_path("http://evil.com/")

    def test_authority_at_sign_rejected(self):
        with pytest.raises(ValueError, match="@"):
            validate_proxy_path("user@evil.com/")

    def test_parent_traversal_rejected(self):
        with pytest.raises(ValueError, match="\\.\\."):
            validate_proxy_path("../../other-api/")

    def test_double_slash_rejected(self):
        with pytest.raises(ValueError, match="//"):
            validate_proxy_path("//evil.com/steal")

    def test_encoded_dot_rejected(self):
        with pytest.raises(ValueError, match="encoded"):
            validate_proxy_path("%2e%2e/secret")

    def test_encoded_slash_rejected(self):
        """Encoded slashes without '..' still caught by encoded check."""
        with pytest.raises(ValueError, match="encoded"):
            validate_proxy_path("secret%2fpath")

    def test_backslash_rejected(self):
        with pytest.raises(ValueError, match="backslash"):
            validate_proxy_path("secret\\path")

    def test_null_byte_rejected(self):
        with pytest.raises(ValueError, match="null"):
            validate_proxy_path("42/\x00")

    def test_encoded_backslash_rejected(self):
        with pytest.raises(ValueError, match="encoded"):
            validate_proxy_path("secret%5cpath")

    def test_combined_traversal_with_encoded_slash(self):
        """Paths with both '..' and encoded chars hit '..' check first."""
        with pytest.raises(ValueError):
            validate_proxy_path("..%2f..%2fetc/passwd")


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
