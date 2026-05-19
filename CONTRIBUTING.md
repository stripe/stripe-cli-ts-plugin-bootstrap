# Contributing to stripe-cli-plugin-bootstrap

Thanks for your interest in contributing to the Stripe CLI plugin bootstrap library!

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) (see `.tool-versions` for the pinned version)
- [pnpm](https://pnpm.io/) 10.x

### Setup

```bash
git clone https://github.com/stripe/stripe-cli-ts-plugin-bootstrap.git
cd stripe-cli-ts-plugin-bootstrap
pnpm install
```

### Building

```bash
pnpm build
```

### Running tests

```bash
pnpm test
```

### Linting

```bash
pnpm lint
pnpm fix   # auto-fix issues
```

## Submitting a pull request

1. Fork the repository and create your branch from `master`.
2. Make your changes. Add or update tests as appropriate.
3. Ensure `pnpm lint` and `pnpm test` pass.
4. Submit your pull request.

## Reporting issues

If you find a bug or have a feature request, please open an issue on GitHub. Include as much detail as possible: steps to reproduce, expected behavior, and your environment.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to conduct@stripe.com.
