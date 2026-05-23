;; Set the package installation directory so that packages aren't stored in the
;; ~/.emacs.d/elpa path.
(require 'package)
(setq package-user-dir (expand-file-name "./.packages"))
(setq package-archives '(("melpa" . "https://melpa.org/packages/")
                         ("elpa" . "https://elpa.gnu.org/packages/")))

;; For babel, disable the need for confirmation of code running
(setq org-confirm-babel-evaluate nil)

;; Initialize the package system
(package-initialize)
(unless package-archive-contents
  (package-refresh-contents))

;; Install dependencies
(package-install 'htmlize)

;; Load the htmlize package (dev)
(require 'htmlize)

;; Enable syntax highlighting in exported HTML (dev)
(setq org-html-htmlize-output-type 'css)

;; Native fontify (dev)
(setq org-src-fontify-natively t)

;; Load the publishing system
(require 'ox-publish)
(require 'subr-x)

(defvar site-html-head
  (concat
   "<link rel=\"stylesheet\" href=\"simple.css\" />\n"
   "<link rel=\"stylesheet\" href=\"css/site.css\" />\n"
   "<script src=\"js/theme-switcher.js\"></script>"))

(defvar site-html-preamble
  "<div style=\"position: fixed; top: 10px; right: 10px;\">
         <button class=\"toggle-theme-btn\" onclick=\"toggleDarkMode()\">Light/Dark</button>
       </div>")

(defun site-html-escape (text)
  "Escape TEXT for use in generated HTML."
  (replace-regexp-in-string
   "\"" "&quot;"
   (replace-regexp-in-string
    ">" "&gt;"
    (replace-regexp-in-string
     "<" "&lt;"
     (replace-regexp-in-string "&" "&amp;" text t t)
     t t)
    t t)
   t t))

(defun site-keyword-value (keyword)
  "Return the first Org KEYWORD value in the current buffer."
  (let ((case-fold-search t))
    (save-excursion
      (goto-char (point-min))
      (when (re-search-forward
             (format "^[ \t]*#\\+%s:[ \t]*\\(.*\\)$" (regexp-quote keyword))
             nil t)
        (string-trim (match-string-no-properties 1))))))

(defun site-insert-article-date (backend)
  "Insert article date metadata near the top of HTML exports."
  (when (eq backend 'html)
    (let ((date (site-keyword-value "DATE")))
      (when (and date (not (string-empty-p date)))
        (goto-char (point-min))
        (while (looking-at "^[ \t]*#\\+.*\n")
          (forward-line 1))
        (insert
         (format "#+HTML: <div class=\"article-meta\"><span class=\"article-date\">%s</span></div>\n\n"
                 (site-html-escape date)))))))

(add-hook 'org-export-before-parsing-hook #'site-insert-article-date)

(setq org-html-validation-link nil
      org-html-head-include-scripts nil
      org-html-head-include-default-style nil
      org-html-head site-html-head
      org-html-preamble site-html-preamble)

;; Define the publishing project
(setq org-publish-project-alist
      (list
       (list "site-assets"
             :base-directory "./assets"
             :base-extension "css\\|js"
             :publishing-directory "./public"
             :recursive t
             :publishing-function 'org-publish-attachment)
       (list "site-pages"
             :recursive t
             :base-directory "./content"
             :publishing-directory "./public"
             :with-date nil
             :with-author nil           ;; Don't include author name
             :with-creator t            ;; Include Emacs and Org versions in footer
             :with-toc nil                ;; Include a table of contents
             :section-numbers nil       ;; Don't include section numbers
             :time-stamp-file nil       ;; Don't include time stamp in file
             :publishing-function 'org-html-publish-to-html)
       (list "tyler_burns_website"
             :components '("site-assets" "site-pages"))))


;; Get rid of "validate" on bottom of site
(setq org-html-validation-link nil) 

;; Generate the site output
(org-publish-project "tyler_burns_website" t)

(message "build complete!")
