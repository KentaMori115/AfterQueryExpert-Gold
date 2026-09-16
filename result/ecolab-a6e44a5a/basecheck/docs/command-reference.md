# Command reference

```text
biomeweaver check
biomeweaver describe
biomeweaver species list
biomeweaver species show <id>
biomeweaver scenario list
biomeweaver simulate <scenario> [--ticks n]
biomeweaver run show <run-id>
biomeweaver population <run-id> <species>
biomeweaver resource <run-id> <resource>
biomeweaver explain <run-id> --species <id> --tick <n>
biomeweaver snapshot verify <run-id>
biomeweaver report <run-id> --format json|csv|markdown
```

Exit codes: `0` success, `2` ecological alerts, `3` invalid capsule, `4`
integrity failure, `5` invalid invocation, `10` internal failure.
