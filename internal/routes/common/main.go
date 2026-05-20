package common

import (
	"github.com/duber000/town-builder/internal/services/auth"
	httphelper "github.com/kukichalang/kukicha/stdlib/http"
	"net/http"
	"strings"
)

func ExtractToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	if strings.HasPrefix(h, "Bearer ") {
		return h[7:]
	}
	return h
}

func CurrentUser(w http.ResponseWriter, r *http.Request) (*auth.UserInfo, bool) {
	token := ExtractToken(r)
	u, err := auth.GetCurrentUser(token)
	if err != nil {
		httphelper.JSONUnauthorized(w, "Not authenticated")
		return nil, false
	}
	return u, true
}
