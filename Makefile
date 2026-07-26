DC=docker compose
DCS=$(DC) exec -T app
IMAGE=orchesty/comparator-worker:$(TAG)

.env:
	sed -e "s/{DEV_UID}/$(shell if [ "$(shell uname)" = "Linux" ]; then echo $(shell id -u); else echo '1001'; fi)/g" \
		-e "s/{DEV_GID}/$(shell if [ "$(shell uname)" = "Linux" ]; then echo $(shell id -g); else echo '1001'; fi)/g" \
		.env.dist > .env

# Build
build: .env
	docker buildx create --name comparator-builder --driver docker-container 2>/dev/null || true
	docker buildx build --builder comparator-builder --no-cache --push --platform linux/amd64,linux/arm64/v8 -t $(IMAGE) .

docker-compose.ci.yml:
	# Comment out any port forwarding
	sed -r 's/^(\s+ports:)$$/#\1/g; s/^(\s+- \$$\{DEV_IP\}.*)$$/#\1/g;' docker-compose.yml > docker-compose.ci.yml

init: .env
	$(DC) pull --ignore-pull-failures
	$(DC) up -d --force-recreate --remove-orphans --build

docker-down-clean: .env
	$(DC) down -v

install:
	$(DCS) pnpm install

update:
	$(DCS) pnpm update

outdated:
	$(DCS) pnpm outdated

lint:
	$(DCS) pnpm run lint-ci

unit:
	$(DCS) pnpm run test

fasttest: lint unit

localtest:
	pnpm run lint
	pnpm run test

test: init install fasttest docker-down-clean

ci-test: test
