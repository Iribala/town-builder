package auth_test

import (
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/services/auth"
	jwtpkg "github.com/golang-jwt/jwt/v5"
	"github.com/kukichalang/kukicha/stdlib/test"
	"testing"
	"time"
)

const TestJwtSecret = "test-secret-key-at-least-32-bytes-long!"

func setupAuthEnabled() {
	s := &config.Settings{JwtSecretKey: TestJwtSecret, JwtAlgorithm: "HS256", DisableJwtAuth: false, Environment: "development"}
	config.SetForTest(s)
}

func setupAuthDisabled() {
	s := &config.Settings{JwtSecretKey: TestJwtSecret, JwtAlgorithm: "HS256", DisableJwtAuth: true, Environment: "development"}
	config.SetForTest(s)
}

func setupProd() {
	s := &config.Settings{JwtSecretKey: TestJwtSecret, JwtAlgorithm: "HS256", DisableJwtAuth: false, Environment: "production"}
	config.SetForTest(s)
}

func signToken(claims jwtpkg.MapClaims, secret string) string {
	tok := jwtpkg.NewWithClaims(jwtpkg.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte(secret))
	if err != nil {
		return ""
	}
	return signed
}

func TestValidKibigiaTokenAccepted(t *testing.T) {
	setupAuthEnabled()
	claims := jwtpkg.MapClaims{"user_id": 1, "username": "testuser", "email": "test@example.com", "exp": time.Now().Add((8 * time.Hour)).Unix(), "iat": time.Now().Unix(), "sub": "1", "town_id": 42}
	tok := signToken(claims, TestJwtSecret)
	result, err := auth.VerifyTokenString(tok)
	test.AssertNoError(t, err)
	test.AssertEqual(t, result.Username, "testuser")
	test.AssertEqual(t, result.Payload["email"], "test@example.com")
}

func TestUsernamePriorityOverSub(t *testing.T) {
	setupAuthEnabled()
	claims := jwtpkg.MapClaims{"username": "alice", "sub": "99", "exp": time.Now().Add(time.Hour).Unix()}
	tok := signToken(claims, TestJwtSecret)
	result, err := auth.VerifyTokenString(tok)
	test.AssertNoError(t, err)
	test.AssertEqual(t, result.Username, "alice")
}

func TestUsernameFallsBackToSub(t *testing.T) {
	setupAuthEnabled()
	claims := jwtpkg.MapClaims{"sub": "bob", "exp": time.Now().Add(time.Hour).Unix()}
	tok := signToken(claims, TestJwtSecret)
	result, err := auth.VerifyTokenString(tok)
	test.AssertNoError(t, err)
	test.AssertEqual(t, result.Username, "bob")
}

func TestExpiredTokenRejected(t *testing.T) {
	setupAuthEnabled()
	claims := jwtpkg.MapClaims{"username": "x", "exp": time.Now().Add(-time.Hour).Unix()}
	tok := signToken(claims, TestJwtSecret)
	_, err := auth.VerifyTokenString(tok)
	test.AssertError(t, err)
}

func TestWrongSecretRejected(t *testing.T) {
	setupAuthEnabled()
	claims := jwtpkg.MapClaims{"username": "x", "exp": time.Now().Add(time.Hour).Unix()}
	tok := signToken(claims, "completely-different-secret-key-here!!")
	_, err := auth.VerifyTokenString(tok)
	test.AssertError(t, err)
}

func TestMissingUsernameAndSubRejected(t *testing.T) {
	setupAuthEnabled()
	claims := jwtpkg.MapClaims{"email": "x@y.com", "exp": time.Now().Add(time.Hour).Unix()}
	tok := signToken(claims, TestJwtSecret)
	_, err := auth.VerifyTokenString(tok)
	test.AssertError(t, err)
}

func TestMalformedTokenRejected(t *testing.T) {
	setupAuthEnabled()
	_, err := auth.VerifyTokenString("not.a.valid.jwt.token")
	test.AssertError(t, err)
}

func TestDevModeBypass(t *testing.T) {
	setupAuthDisabled()
	result, err := auth.GetCurrentUser("")
	test.AssertNoError(t, err)
	test.AssertEqual(t, result.Username, "dev-user")
}

func TestNoCredentialsRaises401(t *testing.T) {
	setupAuthEnabled()
	_, err := auth.GetCurrentUser("")
	test.AssertError(t, err)
}

func TestCreatesDecodableToken(t *testing.T) {
	setupAuthEnabled()
	result, err := auth.CreateAccessToken("alice", 1)
	test.AssertNoError(t, err)
	test.AssertEqual(t, result.TokenType, "bearer")
	test.AssertEqual(t, result.Username, "alice")
	test.AssertEqual(t, result.ExpiresIn, 3600)
	info, verr := auth.VerifyTokenString(result.AccessToken)
	test.AssertNoError(t, verr)
	test.AssertEqual(t, info.Username, "alice")
}

func TestBlockedInProduction(t *testing.T) {
	setupProd()
	_, err := auth.CreateAccessToken("alice", 1)
	test.AssertError(t, err)
}
