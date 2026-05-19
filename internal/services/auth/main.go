package auth

import (
	"errors"
	"github.com/duber000/town-builder/internal/config"
	jwtpkg "github.com/golang-jwt/jwt/v5"
	"github.com/kukichalang/kukicha/stdlib/log"
	"time"
)

type UserInfo struct {
	Username string
	Payload  map[string]any
}

type TokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Username    string `json:"username"`
}

func keyFunc(token *jwtpkg.Token) (any, error) {
	s := config.Current()
	if s == nil {
		return nil, errors.New("config not loaded")
	}
	return []byte(s.JwtSecretKey), nil
}

func VerifyTokenString(token string) (*UserInfo, error) {
	s := config.Current()
	if s == nil {
		return nil, errors.New("config not loaded")
	}
	parsed, err := jwtpkg.Parse(token, keyFunc, jwtpkg.WithValidMethods([]string{s.JwtAlgorithm}))
	if err != nil {
		return nil, errors.New("Invalid authentication credentials")
	}
	if !parsed.Valid {
		return nil, errors.New("Invalid authentication credentials")
	}
	claims, ok := parsed.Claims.(jwtpkg.MapClaims)
	if !ok {
		return nil, errors.New("Invalid authentication credentials")
	}
	payload := map[string]any(claims)
	username := ""
	if v, vok := payload["username"]; vok {
		if str, sok := v.(string); sok {
			username = str
		}
	}
	if username == "" {
		if v, vok := payload["sub"]; vok {
			if str, sok := v.(string); sok {
				username = str
			}
		}
	}
	if username == "" {
		return nil, errors.New("Invalid authentication credentials")
	}
	return &UserInfo{Username: username, Payload: payload}, nil
}

func GetCurrentUser(token string) (*UserInfo, error) {
	s := config.Current()
	if s == nil {
		return nil, errors.New("config not loaded")
	}
	if s.DisableJwtAuth {
		log.Warn("JWT authentication is DISABLED - development mode only!")
		payload := make(map[string]any)
		payload["sub"] = "dev-user"
		return &UserInfo{Username: "dev-user", Payload: payload}, nil
	}
	if token == "" {
		return nil, errors.New("Not authenticated")
	}
	return VerifyTokenString(token)
}

func CreateAccessToken(username string, expiresHours int) (*TokenResponse, error) {
	s := config.Current()
	if s == nil {
		return nil, errors.New("config not loaded")
	}
	if s.Environment == "production" {
		return nil, errors.New("Not found")
	}
	expire := time.Now().Add((time.Duration(expiresHours) * time.Hour))
	claims := jwtpkg.MapClaims{"sub": username, "exp": expire.Unix()}
	method := jwtpkg.GetSigningMethod(s.JwtAlgorithm)
	if method == nil {
		return nil, errors.New("unsupported signing method")
	}
	tok := jwtpkg.NewWithClaims(method, claims)
	signed, err := tok.SignedString([]byte(s.JwtSecretKey))
	if err != nil {
		return nil, err
	}
	return &TokenResponse{AccessToken: signed, TokenType: "bearer", ExpiresIn: (expiresHours * 3600), Username: username}, nil
}
