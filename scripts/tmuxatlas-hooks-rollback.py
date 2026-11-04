#!/usr/bin/env python3
"""Retire les hooks TmuxAtlas ajoutés par `tmuxatlas agent-setup` (Claude + Codex).

Parcourt ~/.claude, ~/.codex et tous les comptes de ~/.local/share/ai-accounts.
Les fichiers absents ou illisibles sont ignorés ; seuls les fichiers modifiés sont réécrits.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ACCOUNTS = Path.home() / '.local/share/ai-accounts'
CODEX_HOOK = re.compile(r'^notify = .*# tmuxatlas-agent-hook\n', flags=re.M)


def write_atomic(path, content):
    """Remplace le fichier d'un coup, en suivant les symlinks et en gardant ses droits."""
    target = os.path.realpath(path)
    fd, temp = tempfile.mkstemp(dir=os.path.dirname(target), prefix='.tmuxatlas-rollback-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(content)
        shutil.copymode(target, temp)
        os.replace(temp, target)
    except BaseException:
        os.unlink(temp)
        raise


def clean_claude(text):
    settings = json.loads(text)
    hooks = settings.get('hooks', {})
    for event in list(hooks):
        matchers = [
            dict(matcher, hooks=[hook for hook in matcher.get('hooks', []) if 'tmuxatlas' not in hook.get('command', '')])
            for matcher in hooks[event]
        ]
        matchers = [matcher for matcher in matchers if matcher['hooks']]
        if matchers:
            hooks[event] = matchers
        else:
            del hooks[event]
    if not hooks:
        settings.pop('hooks', None)
    return json.dumps(settings, indent=2, ensure_ascii=False) + '\n'


def clean_codex(text):
    return CODEX_HOOK.sub('', text)


def has_hook(text):
    return 'tmuxatlas' in text


def process(path, clean):
    try:
        original = path.read_text(encoding='utf-8')
        if not has_hook(original):
            return True
        write_atomic(path, clean(original))
    except FileNotFoundError:
        return True
    except (OSError, ValueError, AttributeError, TypeError) as err:
        print(f'échec {path}: {err}', file=sys.stderr)
        return False
    print('nettoyé', path)
    return True


def main():
    home = Path.home()
    claude = [home / '.claude/settings.json', *sorted(ACCOUNTS.glob('*/config/settings.json'))]
    codex = [home / '.codex/config.toml', *sorted(ACCOUNTS.glob('*/config/config.toml'))]
    results = [process(path, clean_claude) for path in claude] + [process(path, clean_codex) for path in codex]
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
