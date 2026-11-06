package toolevents

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestExtractPromptOptions(t *testing.T) {
	yn := []PromptOption{{"y", "Yes"}, {"n", "No"}}
	tests := []struct {
		name    string
		content string
		want    bool
		msg     string
		options []PromptOption
		submit  bool
	}{
		{"claude menu", "Edit file\n\n╭────╮\n│ Do you want to make this edit? │\n│ ❯ 1. Yes │\n│   2. Yes, and don't ask again │\n│   3. No │\n╰────╯\n Esc to cancel\n", true,
			"Do you want to make this edit?", []PromptOption{{"1", "Yes"}, {"2", "Yes, and don't ask again"}, {"3", "No"}}, false},
		{"plain menu with cursor >", "Proceed?\n> 1. Yes\n  2. No\n", true, "Proceed?", []PromptOption{{"1", "Yes"}, {"2", "No"}}, false},
		{"codex with context between", "Would you like to run the following command?\n\n  $ git push\n\n› 1. Yes, proceed (y)\n  2. No, and tell Codex (esc)\n\n  Press enter to confirm or esc to cancel\n", true,
			"Would you like to run the following command?", []PromptOption{{"1", "Yes, proceed (y)"}, {"2", "No, and tell Codex (esc)"}}, false},
		{"yn paren", "Overwrite file.txt? (y/n)", true, "Overwrite file.txt? (y/n)", yn, true},
		{"yn Y/n", "Continue installing [Y/n] ", true, "Continue installing [Y/n]", yn, true},
		{"yn y/N", "some log\nDelete everything? [y/N]", true, "Delete everything? [y/N]", yn, true},
		{"key options", "Apply this change?\n(y) Oui  (n) Non  (a) Toujours", true, "Apply this change?",
			[]PromptOption{{"y", "Oui"}, {"n", "Non"}, {"a", "Toujours"}}, false},
		{"key options same line", "Allow edit? (y) Yes (n) No", true, "Allow edit?", []PromptOption{{"y", "Yes"}, {"n", "No"}}, false},
		// false positives
		{"numbered text no question", "Steps:\n1. install\n2. build\n3. run\n", false, "", nil, false},
		{"numbered with question but no cursor", "What are the options?\n1. install\n2. build\n", false, "", nil, false},
		{"numbered list followed by lots of output", "Pick?\n> 1. a\n  2. b\nl1\nl2\nl3\nl4\n", false, "", nil, false},
		{"answered menu still on screen", "Pick?\n> 1. a\n  2. b\nGOT:1\n", false, "", nil, false},
		{"non consecutive", "Pick one?\n> 1. a\n  3. b\n", false, "", nil, false},
		{"yn in earlier log line", "(y/n) was printed earlier\n$ ls\nfile\n", false, "", nil, false},
		{"code", "func main() {\n\tfmt.Println(\"a (y) b (n)\")\n}\n", false, "", nil, false},
		{"key options without question", "keys: (q) quit (h) help", false, "", nil, false},
		{"shell prompt", "user@host:~$ ", false, "", nil, false},
		{"empty", "", false, "", nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ExtractPromptOptions(tc.content)
			if got.IsPrompt != tc.want {
				t.Fatalf("IsPrompt=%v want %v (%+v)", got.IsPrompt, tc.want, got)
			}
			if !tc.want {
				if len(got.Options) != 0 || got.Fingerprint != "" {
					t.Fatalf("unexpected options: %+v", got)
				}
				return
			}
			if got.Message != tc.msg || !reflect.DeepEqual(got.Options, tc.options) || got.Submit != tc.submit {
				t.Fatalf("got %+v", got)
			}
			if len(got.Fingerprint) != 64 || got.Fingerprint != Fingerprint(got.Context, got.Message, got.Options) {
				t.Fatalf("bad fingerprint %q", got.Fingerprint)
			}
		})
	}
}

func TestExtractPromptFingerprintChanges(t *testing.T) {
	a := ExtractPromptOptions("Proceed?\n> 1. Yes\n  2. No\n")
	b := ExtractPromptOptions("Proceed now?\n> 1. Yes\n  2. No\n")
	c := ExtractPromptOptions("Proceed?\n  1. Yes\n> 2. No\n")
	if a.Fingerprint == b.Fingerprint {
		t.Fatal("question change must change fingerprint")
	}
	if a.Fingerprint != c.Fingerprint {
		t.Fatal("cursor movement must not change fingerprint")
	}
}

func TestExtractPromptTruncatesAndStripsControl(t *testing.T) {
	long := strings.Repeat("é", 500)
	got := ExtractPromptOptions("\x1b[0mDo it " + long + "?\x07\n> 1. Yes\n  2. No\n")
	if !got.IsPrompt || strings.ContainsAny(got.Message, "\x1b\x07") {
		t.Fatalf("%+v", got)
	}
	if n := len([]rune(got.Message)); n > maxMessageRunes {
		t.Fatalf("message not truncated: %d", n)
	}
}

func TestDetectPromptUnchangedForOptions(t *testing.T) {
	if !DetectPrompt("Overwrite? (y/n)").IsPrompt {
		t.Fatal("DetectPrompt regression")
	}
}

func TestExtractPromptFingerprintCoversTheCommandAboveTheQuestion(t *testing.T) {
	menu := "Do you want to proceed?\n\u276f 1. Yes\n  2. No\n\nEsc to cancel\n"
	push := ExtractPromptOptions("Bash command\n  git push origin main\n\n" + menu)
	wipe := ExtractPromptOptions("Bash command\n  rm -rf build\n\n" + menu)
	if !push.IsPrompt || !wipe.IsPrompt {
		t.Fatalf("prompts not detected: %+v %+v", push, wipe)
	}
	if push.Fingerprint == wipe.Fingerprint {
		t.Fatal("the same question over a different command must not share a fingerprint")
	}
	if len(push.Context) != 2 || push.Context[1] != "git push origin main" {
		t.Fatalf("context = %q", push.Context)
	}
}

func TestExtractPromptContextIsBounded(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 20; i++ {
		b.WriteString("line " + strings.Repeat("x", 300) + "\n")
	}
	b.WriteString("Continue?\n\u276f 1. Yes\n  2. No\n")
	got := ExtractPromptOptions(b.String())
	if len(got.Context) > maxContextLines {
		t.Fatalf("too many context lines: %d", len(got.Context))
	}
	for _, line := range got.Context {
		if utf8.RuneCountInString(line) > maxContextRunes {
			t.Fatalf("context line too long: %d", utf8.RuneCountInString(line))
		}
	}
}
