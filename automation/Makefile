.PHONY: help install setup test test-api test-web test-mobile \
        perf-smoke perf-load100 perf-load500 perf-stress1000 \
        perf-orders10k perf-qr perf-spike security-zap \
        clean reports open-report

API_URL     ?= http://localhost:5000
HOTEL_ID    ?=
ADMIN_ID    ?=
ADMIN_PASS  ?=
K6          := $(shell command -v k6 2>/dev/null || echo k6_not_found)
MAESTRO     := $(shell command -v maestro 2>/dev/null || echo maestro_not_found)

help:
	@echo ""
	@echo "DinePOS Automation — Available targets"
	@echo "────────────────────────────────────────────────────"
	@echo "  make install            Install all npm dependencies"
	@echo "  make setup              Create .env.test from example"
	@echo "  make test               Run all available tests"
	@echo "  make test-api           Run Jest API tests"
	@echo "  make test-web           Run Playwright web tests"
	@echo "  make test-mobile        Run Maestro mobile flows"
	@echo "  make perf-smoke         k6 smoke test (1 VU, 30s)"
	@echo "  make perf-load100       k6 load test (100 VUs, 5m)"
	@echo "  make perf-load500       k6 load test (500 VUs, 14m)"
	@echo "  make perf-stress1000    k6 stress test (1000 VUs, 18m)"
	@echo "  make perf-orders10k     k6 10,000 orders creation"
	@echo "  make perf-qr            k6 100 concurrent QR orders"
	@echo "  make perf-spike         k6 spike test"
	@echo "  make security-zap       OWASP ZAP security scan"
	@echo "  make clean              Delete all report artifacts"
	@echo "  make open-report        Open HTML test report in browser"
	@echo "────────────────────────────────────────────────────"
	@echo ""

install:
	npm install

setup:
	bash scripts/setup-env.sh

test: test-api
	@echo "Run make test-web or make test-mobile for additional tests"

test-api:
	npm run test:api -- --forceExit

test-web:
	npm run test:web

test-mobile:
	@if [ "$(MAESTRO)" = "maestro_not_found" ]; then \
		echo "ERROR: maestro not found. Install: curl -Ls 'https://get.maestro.mobile.dev' | bash"; \
		exit 1; \
	fi
	npm run test:mobile

perf-smoke:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		-e API_URL=$(API_URL) \
		-e ADMIN_ID=$(ADMIN_ID) \
		-e ADMIN_PASSWORD=$(ADMIN_PASS) \
		-e HOTEL_ID=$(HOTEL_ID) \
		performance/k6/smoke-test.js

perf-load100:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		--out json=reports/performance/load100-results.json \
		-e API_URL=$(API_URL) \
		-e ADMIN_ID=$(ADMIN_ID) \
		-e ADMIN_PASSWORD=$(ADMIN_PASS) \
		-e HOTEL_ID=$(HOTEL_ID) \
		performance/k6/load-100.js

perf-load500:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		--out json=reports/performance/load500-results.json \
		-e API_URL=$(API_URL) \
		-e ADMIN_ID=$(ADMIN_ID) \
		-e ADMIN_PASSWORD=$(ADMIN_PASS) \
		-e HOTEL_ID=$(HOTEL_ID) \
		performance/k6/load-500.js

perf-stress1000:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		--out json=reports/performance/stress1000-results.json \
		-e API_URL=$(API_URL) \
		-e ADMIN_ID=$(ADMIN_ID) \
		-e ADMIN_PASSWORD=$(ADMIN_PASS) \
		-e HOTEL_ID=$(HOTEL_ID) \
		performance/k6/stress-1000.js

perf-orders10k:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		--out json=reports/performance/orders10k-results.json \
		-e API_URL=$(API_URL) \
		-e ADMIN_ID=$(ADMIN_ID) \
		-e ADMIN_PASSWORD=$(ADMIN_PASS) \
		performance/k6/orders-10k.js

perf-qr:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		--out json=reports/performance/qr-results.json \
		-e API_URL=$(API_URL) \
		-e HOTEL_ID=$(HOTEL_ID) \
		performance/k6/qr-concurrent.js

perf-spike:
	@[ "$(K6)" = "k6_not_found" ] && echo "ERROR: k6 not found" && exit 1 || true
	k6 run \
		--out json=reports/performance/spike-results.json \
		-e API_URL=$(API_URL) \
		-e ADMIN_ID=$(ADMIN_ID) \
		-e ADMIN_PASSWORD=$(ADMIN_PASS) \
		-e HOTEL_ID=$(HOTEL_ID) \
		performance/k6/spike-test.js

security-zap:
	bash security/zap/run-zap.sh

clean:
	rm -rf reports/html reports/junit reports/coverage \
	       reports/playwright-html reports/playwright \
	       reports/performance reports/security reports/logs \
	       .test-state.json

open-report:
	@if command -v xdg-open &>/dev/null; then xdg-open reports/html/report.html; \
	elif command -v open &>/dev/null; then open reports/html/report.html; \
	else echo "Open manually: reports/html/report.html"; fi
