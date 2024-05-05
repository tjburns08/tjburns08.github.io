#!/bin/sh

# Buld the site
emacs -Q --script build_site.el

# Run the site graph builder
cd /Users/tylerburns/Desktop/projects/tech_projects/active/website/website_graph_view
source .wg_venv/bin/activate
cd src
python3 make_website_graph.py
deactivate
echo "website graph build complete!"
