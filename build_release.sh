#!/bin/bash

#sudo npm install -g web-ext
srcDir="./src"
targetDir="./target"
keyFile="./CookieRipper.pem"

web-ext lint -s $srcDir
web-ext build -s $srcDir -a $targetDir -o
chromium --pack-extension=$srcDir --pack-extension-key=$keyFile
mv "./$srcDir.crx" "$targetDir/CookieRipper_Chromium.crx"
