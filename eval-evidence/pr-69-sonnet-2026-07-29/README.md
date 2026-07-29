# PR #69 Sonnet-first evaluation evidence

This directory makes the 2026-07-29 Keyboardia skill evidence durable. The
three receipts are self-contained, content-addressed records; the `matrices/`
files preserve the v6–v10 benchmark/audit history, including failed eval
designs.

The final answer receipt evaluates Keyboardia commit
`0107ea15dab85499ab9ab4283d68991bad2e6a04`. It embeds the source Git commit and
tree objects, exact skill/manifest/policy/oracle bytes, resolved hidden prompts,
prepared tasks, harness patch, model outputs, grading reports, and committed
per-run artifact inventories. `evals/verify-receipts.mjs` can verify it without
trusting the current branch checkout.

## Receipts

| File | SHA-256 | Purpose |
| --- | --- | --- |
| `final-sonnet-v10-receipt.json` | `963e1007d93ab0db6f6860fc42e36800d472fdf0220c2eba4e6348bb0376cd38` | 36-call final Sonnet answer matrix |
| `autonomous-origin-trace-receipt.json` | `8d59e11fcf660e19b23b3f70911a3156e0cd103d0e43482450f003c463e45469` | origin → verified skill → MCP → tools → read/edit/verify trace |
| `live-mcp-sweep-receipt.json` | `6972e8b27e30a5f46918639f4b604276c5f504d046e23285e835b499a03f2568` | 18-call live MCP execution sweep |

## Matrix reports

| Matrix | Benchmark SHA-256 | Audit SHA-256 |
| --- | --- | --- |
| v6 | `222a41caf3ac70d3b51508cea7998e837e5fee705fe6db4271d84c8f16037889` | `e055b64c236af08a1a5b4c705d62ffa032c6a761d76b8f4321685f8971577af7` |
| v7 | `dcac4ecb85d76f8ecb48ff098f2485be5b3e48e3825d37032b4386bbd277d5b8` | `68dffaadeab7abb47ae0f9608b993550f5a7104772e9d562b33259aaa56a82a0` |
| v8 | `6bc39403526256c578a563b40e64b30da2ab95d57c604514cdee75b45c874de9` | `8e87f17b81c1d91f6817e184606a425ca724ad108fc3d6a092dd4dd0d912f48c` |
| v9 | `5eb2d32acafad10037aac59801a19de4c705938c4b2fb999b412636225d6a6f6` | `f27049c72b3c7fa916cd04b51ca4c3f20d25a102d345d5b92f89da3f49cf634c` |
| v10 | `e19f7b9c912a85564da9ab2ee14375efd99ca9acfae726e4af7d781e46f51403` | `0545b2e79684cb4e947cc373671a86a8234dc68401c6460899d3718f6ae099f1` |

The v6–v9 files are intentionally retained. They show literal-oracle defects,
baseline saturation, disclosed-answer prompts, and the decisions that produced
the focused v10 release slice.

## Verification

From a checkout containing the evaluated receipt tooling:

```sh
node evals/verify-receipts.mjs \
  eval-evidence/pr-69-sonnet-2026-07-29/final-sonnet-v10-receipt.json
```

The receipts provide content integrity and reproducibility. They are not
provider-signed attestations of model identity, execution, or billing.
