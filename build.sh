#!/bin/sh
set -e

# Install .NET 9 SDK
curl -sSL https://dot.net/v1/dotnet-install.sh -o dotnet-install.sh
chmod +x dotnet-install.sh

./dotnet-install.sh -c 9.0 -InstallDir ./dotnet

# Publish the application
./dotnet/dotnet publish -c Release -o output
