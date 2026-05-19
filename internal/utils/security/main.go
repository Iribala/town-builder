package security

import (
	"errors"
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/kukichalang/kukicha/stdlib/files"
	"github.com/kukichalang/kukicha/stdlib/regex"
	strpkg "github.com/kukichalang/kukicha/stdlib/string"
	"net/url"
	"path/filepath"
)

var safeNameRe = regex.MustCompile("^[a-zA-Z0-9._-]+$")

var safePathRe = regex.MustCompile("^[a-zA-Z0-9_.~:/?#\\[\\]=&+,;%-]*$")

func ValidateFilename(filename string, allowedExtensions []string) (string, error) {
	if filename == "" {
		return "", errors.New("filename cannot be empty")
	}
	if (strpkg.Contains(filename, "..") || strpkg.Contains(filename, "/")) || strpkg.Contains(filename, "\\") {
		return "", errors.New("invalid filename: path traversal attempts are not allowed")
	}
	if strpkg.Contains(filename, "\x00") {
		return "", errors.New("invalid filename: null bytes not allowed")
	}
	clean := filepath.Base(filename)
	if !regex.MatchCompiled(safeNameRe, clean) {
		return "", errors.New("invalid filename: only alphanumeric characters, dots, dashes, and underscores allowed")
	}
	if len(allowedExtensions) > 0 {
		matched := false
		for _, ext := range allowedExtensions {
			if strpkg.HasSuffix(clean, ext) {
				matched = true
				break
			}
		}
		if !matched {
			return "", errors.New("invalid file extension")
		}
	}
	return clean, nil
}

func SafeFilepath(filename string, baseDir string, allowedExtensions []string) (string, error) {
	clean, err := ValidateFilename(filename, allowedExtensions)
	if err != nil {
		return "", err
	}
	err_1 := files.MkDirAll(baseDir)
	if err_1 != nil {
		return "", fmt.Errorf("failed to create base directory: %v", err_1)
	}
	base, berr := filepath.Abs(baseDir)
	if berr != nil {
		return "", berr
	}
	full, ferr := filepath.Abs(filepath.Join(base, clean))
	if ferr != nil {
		return "", ferr
	}
	rel, rerr := filepath.Rel(base, full)
	if (rerr != nil) || strpkg.HasPrefix(rel, "..") {
		return "", errors.New("invalid path: file must be within the designated directory")
	}
	return full, nil
}

func ValidateModelPath(category string, modelName string) (string, string, error) {
	if (((category == "") || strpkg.Contains(category, "..")) || strpkg.Contains(category, "/")) || strpkg.Contains(category, "\\") {
		return "", "", errors.New("invalid category: path traversal attempts are not allowed")
	}
	if (((modelName == "") || strpkg.Contains(modelName, "..")) || strpkg.Contains(modelName, "/")) || strpkg.Contains(modelName, "\\") {
		return "", "", errors.New("invalid model name: path traversal attempts are not allowed")
	}
	if !regex.MatchCompiled(safeNameRe, category) {
		return "", "", errors.New("invalid category: only alphanumeric characters, dots, dashes, and underscores allowed")
	}
	if !regex.MatchCompiled(safeNameRe, modelName) {
		return "", "", errors.New("invalid model name: only alphanumeric characters, dots, dashes, and underscores allowed")
	}
	return category, modelName, nil
}

func ValidateApiURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	if host == "" {
		return false
	}
	s := config.Current()
	if s == nil {
		return false
	}
	for _, allowed := range s.AllowedApiDomains {
		if allowed == "" {
			continue
		}
		if (host == allowed) || strpkg.HasSuffix(host, ("."+allowed)) {
			return true
		}
	}
	return false
}

func ValidateProxyPath(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if strpkg.Contains(path, "://") {
		return "", errors.New("proxy path must not contain a URL scheme")
	}
	if strpkg.Contains(path, "@") {
		return "", errors.New("proxy path must not contain '@'")
	}
	if strpkg.Contains(path, "..") {
		return "", errors.New("proxy path must not contain '..'")
	}
	if strpkg.Contains(path, "//") {
		return "", errors.New("proxy path must not contain '//'")
	}
	lower := strpkg.ToLower(path)
	if (strpkg.Contains(lower, "%2e") || strpkg.Contains(lower, "%2f")) || strpkg.Contains(lower, "%5c") {
		return "", errors.New("proxy path must not contain encoded traversal characters")
	}
	if strpkg.Contains(path, "\\") {
		return "", errors.New("proxy path must not contain backslashes")
	}
	if strpkg.Contains(path, "\x00") {
		return "", errors.New("proxy path must not contain null bytes")
	}
	if !regex.MatchCompiled(safePathRe, path) {
		return "", errors.New("proxy path contains disallowed characters")
	}
	return strpkg.TrimPrefix(path, "/"), nil
}
