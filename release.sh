#!/bin/bash

# Marginalia - Automated Release Script
# Usage: ./release.sh [patch|minor|major] "commit message"
# Example: ./release.sh patch "Fix PDF viewer detection"

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not a git repository!"
    exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    print_warning "You have uncommitted changes. These will be included in the commit."
    git status -s
    echo ""
fi

# Get the bump type (default: patch)
BUMP_TYPE="${1:-patch}"
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
    # If first arg isn't a bump type, treat it as commit message
    COMMIT_MSG="$1"
    BUMP_TYPE="patch"
else
    COMMIT_MSG="$2"
fi

# Validate commit message
if [ -z "$COMMIT_MSG" ]; then
    print_error "Commit message is required!"
    echo "Usage: ./release.sh [patch|minor|major] \"commit message\""
    echo "Example: ./release.sh patch \"Fix PDF viewer detection\""
    exit 1
fi

print_info "Starting release process..."
echo ""

# Get the latest tag
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
print_info "Latest tag: $LATEST_TAG"

# Parse version numbers (remove 'v' prefix)
VERSION="${LATEST_TAG#v}"
IFS='.' read -ra VERSION_PARTS <<< "$VERSION"
MAJOR="${VERSION_PARTS[0]:-0}"
MINOR="${VERSION_PARTS[1]:-0}"
PATCH="${VERSION_PARTS[2]:-0}"

# Increment version based on bump type
case $BUMP_TYPE in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
NEW_TAG="v${NEW_VERSION}"

print_info "New version: $NEW_TAG (${BUMP_TYPE} bump)"
echo ""

# Update manifest.json version
print_info "Updating manifest.json version..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" manifest.json
else
    # Linux
    sed -i "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" manifest.json
fi

# Update package.json version if it exists
if [ -f "package.json" ]; then
    print_info "Updating package.json version..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json
    else
        sed -i "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json
    fi
fi

# Build the plugin
print_info "Building plugin..."
npm run build

if [ $? -ne 0 ]; then
    print_error "Build failed!"
    exit 1
fi

print_info "Build successful!"
echo ""

# Git operations
print_info "Staging changes..."
git add -A

print_info "Creating commit..."
git commit -m "$COMMIT_MSG

Version: $NEW_TAG
Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

print_info "Pushing to main..."
git push origin main

print_info "Creating tag $NEW_TAG..."
git tag -a "$NEW_TAG" -m "Release $NEW_TAG

$COMMIT_MSG"

print_info "Pushing tag..."
git push origin "$NEW_TAG"

echo ""
print_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_info "✓ Release complete!"
print_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Version:  $LATEST_TAG → $NEW_TAG"
echo "  Commit:   $COMMIT_MSG"
echo "  Branch:   main"
echo ""
print_info "GitHub Actions will now build and create a release."
print_info "Check: https://github.com/$(git remote get-url origin | sed 's/.*://;s/.git$//')/actions"
echo ""
