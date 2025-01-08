#!/bin/sh

# Instructions: run: ./build.sh "your commit message here"

# Save the original directory for later
original_dir=$(pwd)

# Buld the site
emacs -Q --script build_site.el

# Run the site graph builder
cd /Users/tylerburns/Desktop/projects/tech_projects/active/website/website_graph_view
source .wg_venv/bin/activate
cd src || exit
python3 make_website_graph.py
deactivate
echo "website graph build complete!"

# Return to the original directory
cd "$original_dir" || exit

# GitHub operations
if [ "$#" -ne 1 ]; then
  echo "Commit failed due to zero or more than one argument. Proper usage: $0 <commit-message>"
  exit 1
fi

commit_message="$1"
git add .
git commit -m "$commit_message"
git push origin main
