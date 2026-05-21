package security_test

import (
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/utils/security"
	strpkg "github.com/kukichalang/kukicha/stdlib/string"
	"github.com/kukichalang/kukicha/stdlib/test"
	"testing"
)

func setup() {
	s := &config.Settings{AllowedDomains: "localhost,127.0.0.1", AllowedApiDomains: []string{"localhost", "127.0.0.1"}}
	config.SetForTest(s)
}

func TestApiUrlLocalhostAllowed(t *testing.T) {
	setup()
	test.AssertTrue(t, security.ValidateApiURL("http://localhost:8000/api/towns/"))
}

func TestApiUrl127Allowed(t *testing.T) {
	setup()
	test.AssertTrue(t, security.ValidateApiURL("http://127.0.0.1:8000/api/towns/"))
}

func TestApiUrlSubdomainMatches(t *testing.T) {
	setup()
	test.AssertTrue(t, security.ValidateApiURL("http://api.localhost:8000/api/"))
}

func TestApiUrlExternalRejected(t *testing.T) {
	setup()
	test.AssertFalse(t, security.ValidateApiURL("http://evil.com/api/"))
}

func TestApiUrlEmptyRejected(t *testing.T) {
	setup()
	test.AssertFalse(t, security.ValidateApiURL(""))
}

func TestApiUrlNoHostnameRejected(t *testing.T) {
	setup()
	test.AssertFalse(t, security.ValidateApiURL("not-a-url"))
}

func TestApiUrlPartialMatchRejected(t *testing.T) {
	setup()
	test.AssertFalse(t, security.ValidateApiURL("http://malicious-localhost.com/"))
}

func TestProxyEmptyPath(t *testing.T) {
	result, err := security.ValidateProxyPath("")
	test.AssertNoError(t, err)
	test.AssertEqual(t, result, "")
}

func TestProxyNumericId(t *testing.T) {
	result, err := security.ValidateProxyPath("42/")
	test.AssertNoError(t, err)
	test.AssertEqual(t, result, "42/")
}

func TestProxyLeadingSlashStripped(t *testing.T) {
	result, err := security.ValidateProxyPath("/42/")
	test.AssertNoError(t, err)
	test.AssertEqual(t, result, "42/")
}

func TestProxyNestedPath(t *testing.T) {
	result, err := security.ValidateProxyPath("42/layout/")
	test.AssertNoError(t, err)
	test.AssertEqual(t, result, "42/layout/")
}

func TestProxySchemeRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("http://evil.com/")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "scheme"))
}

func TestProxyAtSignRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("user@evil.com/")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "@"))
}

func TestProxyParentTraversalRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("../../other-api/")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), ".."))
}

func TestProxyDoubleSlashRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("//evil.com/steal")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "//"))
}

func TestProxyEncodedDotRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("%2e%2e/secret")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "encoded"))
}

func TestProxyEncodedSlashRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("secret%2fpath")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "encoded"))
}

func TestProxyBackslashRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("secret\\path")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "backslash"))
}

func TestProxyNullByteRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("42/\x00")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "null"))
}

func TestProxyEncodedBackslashRejected(t *testing.T) {
	_, err := security.ValidateProxyPath("secret%5cpath")
	test.AssertError(t, err)
	test.AssertTrue(t, strpkg.Contains(err.Error(), "encoded"))
}

func TestProxyCombinedTraversalEncoded(t *testing.T) {
	_, err := security.ValidateProxyPath("..%2f..%2fetc/passwd")
	test.AssertError(t, err)
}

func TestFilenameClean(t *testing.T) {
	out, err := security.ValidateFilename("town_data.json", []string{})
	test.AssertNoError(t, err)
	test.AssertEqual(t, out, "town_data.json")
}

func TestFilenameAlphanumericDotsDashes(t *testing.T) {
	out, err := security.ValidateFilename("my-town_v2.json", []string{})
	test.AssertNoError(t, err)
	test.AssertEqual(t, out, "my-town_v2.json")
}

func TestFilenameTraversalRejected(t *testing.T) {
	_, err := security.ValidateFilename("../etc/passwd", []string{})
	test.AssertError(t, err)
}

func TestFilenameForwardSlashRejected(t *testing.T) {
	_, err := security.ValidateFilename("path/file.json", []string{})
	test.AssertError(t, err)
}

func TestFilenameBackslashRejected(t *testing.T) {
	_, err := security.ValidateFilename("path\\file.json", []string{})
	test.AssertError(t, err)
}

func TestFilenameNullBytesRejected(t *testing.T) {
	_, err := security.ValidateFilename("file\x00.json", []string{})
	test.AssertError(t, err)
}

func TestFilenameEmptyRejected(t *testing.T) {
	_, err := security.ValidateFilename("", []string{})
	test.AssertError(t, err)
}

func TestFilenameSpecialCharsRejected(t *testing.T) {
	_, err := security.ValidateFilename("file name.json", []string{})
	test.AssertError(t, err)
}

func TestFilenameExtensionAllowed(t *testing.T) {
	out, err := security.ValidateFilename("data.json", []string{".json"})
	test.AssertNoError(t, err)
	test.AssertEqual(t, out, "data.json")
}

func TestFilenameExtensionRejected(t *testing.T) {
	_, err := security.ValidateFilename("data.exe", []string{".json"})
	test.AssertError(t, err)
}

func TestModelPathClean(t *testing.T) {
	cat, name, err := security.ValidateModelPath("buildings", "house.glb")
	test.AssertNoError(t, err)
	test.AssertEqual(t, cat, "buildings")
	test.AssertEqual(t, name, "house.glb")
}

func TestModelPathCategoryTraversalRejected(t *testing.T) {
	_, _, err := security.ValidateModelPath("../etc", "house.glb")
	test.AssertError(t, err)
}

func TestModelPathModelTraversalRejected(t *testing.T) {
	_, _, err := security.ValidateModelPath("buildings", "../secret.glb")
	test.AssertError(t, err)
}
