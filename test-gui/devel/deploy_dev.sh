#!/bin/bash

set -ex

TARGET=gs://figurl/franklab-views-dev1

yarn build
gsutil -m cp -R ./build/* $TARGET/