#!/bin/bash

set -ex

TARGET=gs://figurl/franklab-views-dev2a

yarn build
gsutil -m cp -R ./build/* $TARGET/