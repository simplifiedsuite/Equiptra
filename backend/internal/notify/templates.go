package notify

import "fmt"

// RenderPasswordReset — the only email this app sends today. See
// sendgrid.go's own comment: ported from Ralto, same wording.
func RenderPasswordReset(resetURL string) (subject, body string) {
	subject = "Reset your Equiptra password"
	body = fmt.Sprintf(
		`We received a request to reset your Equiptra password. <a href="%s">Choose a new password</a>. This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email.`,
		resetURL,
	)
	return subject, body
}
