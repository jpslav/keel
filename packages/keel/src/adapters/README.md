# packages/keel/src/adapters

keel's adapters: one of the two directories allowed to import vendor SDKs (lint-enforced). The other is
an app's own `apps/<app>/src/adapters/real/`, for a vendor keel has no port for
(`docs/recipes/app-owned-adapter.md`). Each port gets a real adapter and a fake adapter; fakes are
first-class (dev, demo, and E2E all run on them).
