package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// Client is a minimal SendGrid v3 Mail Send wrapper — hand-rolled rather
// than pulling in SendGrid's Go SDK, since the API surface actually needed
// (one recipient, one subject, one HTML body) is a single small JSON POST.
// Ported from Ralto's own internal/notify/sendgrid.go (same repo family,
// same SendGrid account/authenticated domain) — Equiptra had no email
// infrastructure at all before this.
type Client struct {
	apiKey    string
	fromEmail string
	fromName  string
	http      *http.Client
}

// NewClient returns nil if SENDGRID_API_KEY is unset — email notifications
// are then disabled rather than the app failing to boot, matching how
// storage.NewSupabaseClient already feature-gates on missing env vars here.
func NewClient() *Client {
	apiKey := os.Getenv("SENDGRID_API_KEY")
	if apiKey == "" {
		return nil
	}
	fromEmail := os.Getenv("SENDGRID_FROM_EMAIL")
	if fromEmail == "" {
		fromEmail = "no-reply@simplifiedsuite.io"
	}
	fromName := os.Getenv("SENDGRID_FROM_NAME")
	if fromName == "" {
		fromName = "Equiptra"
	}
	return &Client{apiKey: apiKey, fromEmail: fromEmail, fromName: fromName, http: &http.Client{}}
}

type sendGridPayload struct {
	Personalizations []sendGridPersonalization `json:"personalizations"`
	From             sendGridAddress           `json:"from"`
	Subject          string                    `json:"subject"`
	Content          []sendGridContent         `json:"content"`
}

type sendGridPersonalization struct {
	To []sendGridAddress `json:"to"`
}

type sendGridAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type sendGridContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// SendEmail sends a single HTML email. Errors are returned, not swallowed.
func (c *Client) SendEmail(toEmail, toName, subject, htmlBody string) error {
	payload := sendGridPayload{
		Personalizations: []sendGridPersonalization{{To: []sendGridAddress{{Email: toEmail, Name: toName}}}},
		From:             sendGridAddress{Email: c.fromEmail, Name: c.fromName},
		Subject:          subject,
		Content:          []sendGridContent{{Type: "text/html", Value: htmlBody}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshaling sendgrid payload: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building sendgrid request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("calling sendgrid: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		// See Ralto's own version of this fix: the response body names the
		// specific check that failed (unverified sender, bad key, etc.) —
		// a bare status code was worthless for diagnosing the first-ever
		// send failure there, so this doesn't repeat that mistake here.
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("sendgrid returned status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
