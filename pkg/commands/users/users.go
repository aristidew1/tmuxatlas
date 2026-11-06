package users

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/LosFurina/tmuxatlas/pkg/accounts"
	"github.com/LosFurina/tmuxatlas/pkg/common"
	"github.com/urfave/cli/v3"
)

func bootstrap(_ context.Context, c *cli.Command) error {
	file := c.String("password-hash-file")
	stdin := c.Bool("password-stdin")
	if (file == "") == !stdin {
		return errors.New("indiquez exactement une source de mot de passe")
	}
	var hash []byte
	var err error
	if stdin {
		var password []byte
		password, err = io.ReadAll(io.LimitReader(os.Stdin, 803))
		password = []byte(strings.TrimSuffix(strings.TrimSuffix(string(password), "\n"), "\r"))
		if err == nil {
			var encoded string
			encoded, err = accounts.HashPassword(string(password))
			hash = []byte(encoded)
		}
	} else {
		hash, err = os.ReadFile(file)
		hash = []byte(strings.TrimSpace(string(hash)))
	}
	if err != nil {
		return fmt.Errorf("lecture du mot de passe : %w", err)
	}
	store, err := accounts.NewStore()
	if err != nil {
		return err
	}
	_, err = store.BootstrapAdmin(c.String("username"), string(hash), c.Bool("force"))
	return err
}

func init() {
	common.RegisterCommand(&cli.Command{
		Name: "users", Usage: "Gérer les comptes",
		Commands: []*cli.Command{{
			Name: "bootstrap-admin", Usage: "Initialiser le compte administrateur",
			Flags: []cli.Flag{
				&cli.StringFlag{Name: "username", Required: true},
				&cli.StringFlag{Name: "password-hash-file"},
				&cli.BoolFlag{Name: "password-stdin"},
				&cli.BoolFlag{Name: "force"},
			},
			Action: bootstrap,
		}},
	})
}
