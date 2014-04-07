define(function (require, exports) {
    "use strict";

    var EditorManager = brackets.getModule("editor/EditorManager"),
        FileUtils = brackets.getModule("file/FileUtils");

    var marked = require("marked"),
        ErrorHandler = require("src/ErrorHandler"),
        Events = require("src/Events"),
        EventEmitter = require("src/EventEmitter"),
        Git = require("src/Git/Git"),
        Preferences = require("src/Preferences"),
        Strings = require("strings"),
        Utils = require("src/Utils");

    var historyViewerTemplate = require("text!templates/history-viewer.html");

    var commit     = null;

    function attachEvents($viewer) {
        $viewer
            .on("click.HistoryViewer", ".commit-files a:not(.active)", function () {
                    // Open the clicked diff
                    $(".commit-files a.active").attr("scrollPos", $(".commit-diff").scrollTop());
                    var self = $(this);
                    // If this diff was not previously loaded then load it
                    if (!self.is(".loaded")) {
                        Git.getDiffOfFileFromCommit(commit.hash, $(this).text().trim()).then(function (diff) {
                            $viewer.find(".commit-files a").removeClass("active");
                            self.addClass("active loaded");
                            $viewer.find(".commit-diff").html(Utils.formatDiff(diff));
                            $(".commit-diff").scrollTop(self.attr("scrollPos") || 0);
                        });
                    }
                    // If this diff was previously loaded just open it
                    else {
                        self.addClass("active");
                    }
                })
            .on("click.HistoryViewer", ".commit-files a.active", function () {
                // Close the clicked diff
                $(this).removeClass("active");
            })
            .on("click.HistoryViewer", ".close", function () {
                // Close history viewer
                remove();
            });

        // Add/Remove shadown on bottom of header
        $viewer.find(".body")
            .on("scroll.HistoryViewer", function () {
                if ($viewer.find(".body").scrollTop() > 0) {
                    $viewer.find(".header").addClass("shadow");
                }
                else {
                    $viewer.find(".header").removeClass("shadow");
                }
            });

        // Enable actions on advanced buttons if requested by user's preferences
        if (Preferences.get("enableAdvancedFeatures")) {
            attachAdvancedEvents($viewer);
        }
    }

    function attachAdvancedEvents($viewer) {
        var refreshCallback  = function () {
            // dialog.close();
            EventEmitter.emit(Events.REFRESH_ALL);
        };

        $viewer.on("click.HistoryViewer", ".btn-checkout", function () {
            var cmd = "git checkout " + commit.hash;
            Utils.askQuestion(Strings.TITLE_CHECKOUT,
                              Strings.DIALOG_CHECKOUT + "<br><br>" + cmd,
                              {booleanResponse: true, noescape: true})
                .then(function (response) {
                    if (response === true) {
                        return Git.checkout(commit.hash).then(refreshCallback);
                    }
                });
        });

        $viewer.on("click.HistoryViewer", ".btn-reset-hard", function () {
            var cmd = "git reset --hard " + commit.hash;
            Utils.askQuestion(Strings.TITLE_RESET,
                              Strings.DIALOG_RESET_HARD + "<br><br>" + cmd,
                              {booleanResponse: true, noescape: true})
                .then(function (response) {
                    if (response === true) {
                        return Git.reset("--hard", commit.hash).then(refreshCallback);
                    }
                });
        });

        $viewer.on("click.HistoryViewer", ".btn-reset-mixed", function () {
            var cmd = "git reset --mixed " + commit.hash;
            Utils.askQuestion(Strings.TITLE_RESET,
                              Strings.DIALOG_RESET_MIXED + "<br><br>" + cmd,
                              {booleanResponse: true, noescape: true})
                .then(function (response) {
                    if (response === true) {
                        return Git.reset("--mixed", commit.hash).then(refreshCallback);
                    }
                });
        });

        $viewer.on("click.HistoryViewer", ".btn-reset-soft", function () {
            var cmd = "git reset --soft " + commit.hash;
            Utils.askQuestion(Strings.TITLE_RESET,
                              Strings.DIALOG_RESET_SOFT + "<br><br>" + cmd,
                              {booleanResponse: true, noescape: true})
                .then(function (response) {
                    if (response === true) {
                        return Git.reset("--soft", commit.hash).then(refreshCallback);
                    }
                });
        });
    }

    function renderViewerContent($viewer, files, selectedFile) {
        var bodyMarkdown = marked(commit.body, {gfm: true, breaks: true});

        $viewer.append(Mustache.render(historyViewerTemplate, {
            commit: commit,
            bodyMarkdown: bodyMarkdown,
            useGravatar: Preferences.get("useGravatar"),
            files: files,
            Strings: Strings,
            enableAdvancedFeatures: Preferences.get("enableAdvancedFeatures")
        }));

        var firstFile = selectedFile || $viewer.find(".commit-files ul li:first-child").text().trim();
        if (firstFile) {
            Git.getDiffOfFileFromCommit(commit.hash, firstFile).then(function (diff) {
                var $fileEntry = $viewer.find(".commit-files a[data-file='" + firstFile + "']").first(),
                    $commitFiles = $viewer.find(".commit-files");
                $fileEntry.addClass("active");
                if ($commitFiles.length) {
                    $commitFiles.animate({ scrollTop: $fileEntry.offset().top - $commitFiles.height() });
                }
                $viewer.find(".commit-diff").html(Utils.formatDiff(diff));
            });
        }

        attachEvents($viewer);
    }

    function render(hash, $editorHolder) {
        var $container = $("<div>").addClass("git spinner large spin");
        Git.getFilesFromCommit(commit.hash).then(function (files) {
            var list = files.map(function (file) {
                var fileExtension = FileUtils.getSmartFileExtension(file),
                    i = file.lastIndexOf("." + fileExtension),
                    fileName = file.substring(0, fileExtension && i >= 0 ? i : file.length);
                return {name: fileName, extension: fileExtension ? "." + fileExtension : "", file: file};
            });
            var file = $("#git-panel .git-history-list").data("file-relative");
            return renderViewerContent($container, list, file);
        }).catch(function (err) {
            ErrorHandler.showError(err, "Failed to load list of diff files");
        }).finally(function () {
            $container.removeClass("spinner large spin");
        });
        return $container.appendTo($editorHolder);
    }

    function onRemove() {
        // detach events that were added by this viewer to another element than one added to $editorHolder
        // FIXME: What is $viewer? It's not defined anywhere :(
        //$viewer.off(".HistoryViewer");
    }

    function show(commitInfo) {

        commit = commitInfo;
        // this is a "private" API but it's so convienient it's a sin not to use it
        EditorManager._showCustomViewer({
            render: render,
            onRemove: onRemove
        }, commit.hash);
    }

    function remove() {

        // FIXME: I'd like to use `_removeCustomViewer()` but seems like it's not exposed by Brackets API...
        // EditorManager._removeCustomViewer();

    }

    // Public API
    exports.show = show;

});
