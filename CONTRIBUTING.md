# Contributing

Money Monkey is a personal project shared for personal use, learning and demos. Issues and pull requests are
welcome; please keep in mind that it is maintained in spare time.

## Before a pull request

- Build and test: `dotnet build` and the two test executables (`dotnet run --project tests/Folio.Core.Tests`,
  `dotnet run --project tests/Folio.Api.Tests`, the latter needs Docker), then `cd web; npm ci; npx ng build;
  npx ng test --watch=false`. The browser checks in `tests/browser` run against a local container; see the README.
- Keep the ledger engine (`src/Folio.Core`) free of framework code, and add a test for every behaviour change.
- Text shown to people uses Canadian English (colour, centre, cheque).
- Describe what changed and why in the pull request; small, focused changes are easier to review.

By contributing you agree that your contribution is licensed under the repository's licence
(PolyForm Noncommercial 1.0.0).
