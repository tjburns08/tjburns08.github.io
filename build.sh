#!/bin/sh

# Buld the site
emacs -Q --script build_site.el

# Run the site graph builder
cd /Users/tylerburns/Documents/projects/website_graph_view/
source .wg_venv/bin/activate
cd src
python make_website_graph.py
deactivate
echo "website graph build complete!"
