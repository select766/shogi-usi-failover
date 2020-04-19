#!/bin/bash

mkdir -p shogi-usi-failover/log
cp -a node.exe LICENSE* README.md usi.bat package.json engine.json.example dist shogi-usi-failover
zip -r shogi-usi-failover.zip shogi-usi-failover
