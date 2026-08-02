# packages/keel/src/adapters

The only directory allowed to import vendor SDKs (lint-enforced). Each port gets a real adapter and a fake
adapter; fakes are first-class (dev, demo, and E2E all run on them).
