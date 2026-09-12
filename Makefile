.PHONY: daemon daemon-install daemon-build app bundle run dev clean install

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

daemon-install:
	cd $(ROOT)/daemon && npm install

daemon:
	cd $(ROOT)/daemon && npm start

daemon-build:
	cd $(ROOT)/daemon && npm run build

app:
	cd $(ROOT)/app && swift build -c release --product Liuli
	$(ROOT)/scripts/bundle.sh

bundle: app

dev:
	$(ROOT)/scripts/dev.sh

run: app
	open $(ROOT)/dist/Liuli.app

install: app
	mkdir -p "$(HOME)/Applications"
	rm -rf "$(HOME)/Applications/Liuli.app"
	cp -R "$(ROOT)/dist/Liuli.app" "$(HOME)/Applications/Liuli.app"
	open "$(HOME)/Applications/Liuli.app"

clean:
	rm -rf $(ROOT)/app/.build $(ROOT)/dist/Liuli.app $(ROOT)/daemon/node_modules $(ROOT)/daemon/dist
