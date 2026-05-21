package django_client

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/duber000/town-builder/internal/config"
	"github.com/duber000/town-builder/internal/utils/security"
	"github.com/kukichalang/kukicha/stdlib/json"
	"github.com/kukichalang/kukicha/stdlib/log"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ProxyResponse struct {
	StatusCode int
	Body       []byte
	Headers    map[string][]string
}

var fieldsToPropagate = []string{"latitude", "longitude", "description", "population", "area", "established_date", "place_type", "full_address", "town_image"}

func httpClient() *http.Client {
	return &http.Client{Timeout: (10 * time.Second)}
}

func getHeaders() map[string]string {
	h := make(map[string]string)
	h["Content-Type"] = "application/json"
	s := config.Current()
	if (s != nil) && (strings.TrimSpace(s.ApiToken) != "") {
		h["Authorization"] = ("Token " + s.ApiToken)
	}
	return h
}

func GetBaseURL() (string, error) {
	s := config.Current()
	if s == nil {
		return "", errors.New("config not loaded")
	}
	baseURL := s.ApiURL
	if !strings.HasSuffix(baseURL, "/") {
		baseURL = (baseURL + "/")
	}
	if !security.ValidateApiURL(baseURL) {
		log.Error(fmt.Sprintf("API URL '%v' is not in the allowed domains list", baseURL))
		return "", errors.New("API URL is not allowed")
	}
	return baseURL, nil
}

func applyHeaders(req *http.Request, headers map[string]string) {
	for k, v := range headers {
		req.Header.Set(k, v)
	}
}

func PrepareDjangoPayload(requestPayload map[string]any, normalizedTownData map[string]any, townName string, isUpdate bool) map[string]any {
	currentLayoutData := normalizedTownData
	if currentLayoutData == nil {
		currentLayoutData = make(map[string]any)
	}
	payload := make(map[string]any)
	payload["layout_data"] = currentLayoutData
	effectiveName := townName
	if effectiveName == "" {
		if v, ok := currentLayoutData["townName"].(string); ok && (v != "") {
			effectiveName = v
		} else if v, ok := currentLayoutData["name"].(string); ok && (v != "") {
			effectiveName = v
		}
	}
	if !isUpdate {
		if effectiveName != "" {
			payload["name"] = effectiveName
		} else {
			log.Warn("Name is missing for a create operation. Django will likely reject this.")
		}
	}
	for _, key := range fieldsToPropagate {
		value, ok := requestPayload[key]
		if !ok || (value == nil) {
			value, ok = currentLayoutData[key]
		}
		if ok && (value != nil) {
			payload[key] = value
		}
	}
	return payload
}

func doJSON(method string, fullURL string, body map[string]any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Bytes(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, fullURL, reader)
	if err != nil {
		return nil, err
	}
	applyHeaders(req, getHeaders())
	return httpClient().Do(req)
}

func decodeJSON(resp *http.Response) (map[string]any, error) {
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	out := make(map[string]any)
	perr := json.ParseInto(raw, &out)
	if perr != nil {
		return nil, perr
	}
	return out, nil
}

func GetTownByID(townID int) (map[string]any, error) {
	baseURL, err := GetBaseURL()
	if err != nil {
		return nil, err
	}
	fullURL := fmt.Sprintf("%s%d/", baseURL, townID)
	log.Info(fmt.Sprintf("Fetching town %v from Django: %v", townID, fullURL))
	resp, herr := doJSON("GET", fullURL, nil)
	if herr != nil {
		return nil, herr
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("django returned status %v", resp.StatusCode)
	}
	return decodeJSON(resp)
}

func SearchTownByName(townName string) (int, bool, error) {
	baseURL, err := GetBaseURL()
	if err != nil {
		return 0, false, err
	}
	params := url.Values{}
	params.Set("name", townName)
	fullURL := ((baseURL + "?") + params.Encode())
	log.Debug(fmt.Sprintf("Searching for town by name: %v", townName))
	resp, herr := doJSON("GET", fullURL, nil)
	if herr != nil {
		return 0, false, herr
	}
	if resp.StatusCode == 404 {
		resp.Body.Close()
		log.Info(fmt.Sprintf("No town found with name '%v' (404)", townName))
		return 0, false, nil
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return 0, false, fmt.Errorf("django returned status %v", resp.StatusCode)
	}
	defer resp.Body.Close()
	raw, rerr := io.ReadAll(resp.Body)
	if rerr != nil {
		return 0, false, rerr
	}
	var results []any
	var parsedAny any
	perr := json.ParseInto(raw, &parsedAny)
	if perr != nil {
		return 0, false, perr
	}
	if arr, ok := parsedAny.([]any); ok {
		results = arr
	} else if data, ok := parsedAny.(map[string]any); ok {
		if arr, aok := data["results"].([]any); aok {
			results = arr
		}
	}
	if (results == nil) || (len(results) == 0) {
		log.Info(fmt.Sprintf("No town found with name '%v'", townName))
		return 0, false, nil
	}
	first, fok := results[0].(map[string]any)
	if !fok {
		return 0, false, nil
	}
	idVal, idOk := first["id"]
	if !idOk {
		return 0, false, nil
	}
	townID := 0
	switch v := idVal.(type) {
	case float64:
		townID = int(v)
	case int:
		townID = v
	default:
		return 0, false, nil
	}
	if len(results) > 1 {
		log.Warn(fmt.Sprintf("Found %v towns named '%v'. Returning the first one (ID: %v).", len(results), townName, townID))
	} else {
		log.Info(fmt.Sprintf("Found existing town by name '%v' with ID: %v", townName, townID))
	}
	return townID, true, nil
}

func CreateTown(requestPayload map[string]any, normalizedTownData map[string]any, townName string) (map[string]any, error) {
	baseURL, err := GetBaseURL()
	if err != nil {
		return nil, err
	}
	payload := PrepareDjangoPayload(requestPayload, normalizedTownData, townName, false)
	resp, herr := doJSON("POST", baseURL, payload)
	if herr != nil {
		return nil, herr
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("django returned status %v", resp.StatusCode)
	}
	data, derr := decodeJSON(resp)
	if derr != nil {
		return nil, derr
	}
	out := make(map[string]any)
	out["status"] = "success"
	out["town_id"] = data["id"]
	out["response"] = data
	return out, nil
}

func UpdateTown(townID int, requestPayload map[string]any, normalizedTownData map[string]any, townName string) (map[string]any, error) {
	baseURL, err := GetBaseURL()
	if err != nil {
		return nil, err
	}
	fullURL := fmt.Sprintf("%s%d/", baseURL, townID)
	payload := PrepareDjangoPayload(requestPayload, normalizedTownData, townName, true)
	resp, herr := doJSON("PATCH", fullURL, payload)
	if herr != nil {
		return nil, herr
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("django returned status %v", resp.StatusCode)
	}
	resp.Body.Close()
	log.Info(fmt.Sprintf("Town layout successfully updated via PATCH to Django backend for town_id: %v", townID))
	out := make(map[string]any)
	out["status"] = "success"
	out["town_id"] = townID
	return out, nil
}

func ProxyRequest(method string, path string, headers map[string]string, params map[string]string, body []byte) (*ProxyResponse, error) {
	baseURL, err := GetBaseURL()
	if err != nil {
		return nil, err
	}
	safePath, serr := security.ValidateProxyPath(path)
	if serr != nil {
		return nil, serr
	}
	fullURL := (baseURL + safePath)
	if !security.ValidateApiURL(fullURL) {
		return nil, fmt.Errorf("Constructed proxy URL is not allowed: %v", fullURL)
	}
	methodLower := strings.ToLower(method)
	allowed := []string{"get", "post", "put", "patch", "delete"}
	valid := false
	for _, m := range allowed {
		if m == methodLower {
			valid = true
			break
		}
	}
	if !valid {
		return nil, fmt.Errorf("Unsupported HTTP method: %v", method)
	}
	if len(params) > 0 {
		qs := url.Values{}
		for k, v := range params {
			qs.Set(k, v)
		}
		sep := "?"
		if strings.Contains(fullURL, "?") {
			sep = "&"
		}
		fullURL = ((fullURL + sep) + qs.Encode())
	}
	var reader io.Reader
	if (body != nil) && (len(body) > 0) {
		reader = bytes.NewReader(body)
	}
	req, rerr := http.NewRequest(strings.ToUpper(methodLower), fullURL, reader)
	if rerr != nil {
		return nil, rerr
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	s := config.Current()
	if (s != nil) && (s.ApiToken != "") {
		req.Header.Set("Authorization", ("Token " + s.ApiToken))
	}
	log.Debug(fmt.Sprintf("Proxying %v request to %v", method, fullURL))
	resp, derr := httpClient().Do(req)
	if derr != nil {
		return nil, derr
	}
	defer resp.Body.Close()
	raw, ierr := io.ReadAll(resp.Body)
	if ierr != nil {
		return nil, ierr
	}
	return &ProxyResponse{StatusCode: resp.StatusCode, Body: raw, Headers: resp.Header}, nil
}
