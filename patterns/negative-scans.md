# Negative Scans

Some checks are successful when they find nothing. Sensitive-string scans, forbidden-file scans, and "no generated junk committed" checks often work this way.

Many search tools return a non-zero exit code when they find no matches. That is useful in a terminal, but it can look like a scary task failure in automation logs unless the script handles it deliberately.

## Pattern

Wrap negative scans so the outcomes are clear:

- `0`: matches were found, and the script should report the findings.
- `1`: no matches were found, and that is success for this check.
- Any other exit code: the tool itself failed and should be treated as a real error.

## Example

```bash
set +e
rg -n 'PRIVATE_PATTERN|SECRET_PATTERN' .
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "scan found matches"
  exit 1
fi

if [ "$status" -eq 1 ]; then
  echo "scan passed: no matches"
  exit 0
fi

echo "scan failed: rg exited with ${status}"
exit "$status"
```

Use placeholder patterns in public repos. Keep real private identifiers, account names, filters, paths, and tokens out of examples.

