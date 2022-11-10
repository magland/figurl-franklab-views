#!/bin/bash

set -ex

TARGET=gs://figurl/franklab-views-dev1k

yarn build
gsutil -m cp -R ./build/* $TARGET/