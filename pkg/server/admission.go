package server

import (
	"net/http"

	"github.com/LosFurina/tmuxatlas/pkg/auth"
	"github.com/LosFurina/tmuxatlas/pkg/ingress"
)

func admissionMiddleware(policy *ingress.Policy, category ingress.Category) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			source := auth.ClientIP(r)
			lease, err := policy.Acquire(category, source)
			if err != nil {
				http.Error(w, "request admission rejected", ingress.HTTPStatus(err))
				return
			}
			defer lease.Release()
			next.ServeHTTP(w, r)
		})
	}
}
