# Git commits

When creating a git commit in this repository, always end the commit message with:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

Use "Claude" generically, not a specific model name/version (e.g. not "Claude Sonnet 5") — the model running a given session changes over time, and a hardcoded version string would go stale.

This applies to every commit, not just the first one in a session.
