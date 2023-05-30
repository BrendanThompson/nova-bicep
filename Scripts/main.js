var languageServer = null;

exports.activate = function () {
    languageServer = new BicepLanguageServer();
}

exports.deactivate = function () {
    if (languageServer) {
        languageServer.deactivate();
        languageServer = null;
    }
}

class BicepLanguageServer {
    constructor() {
        this.languageClient = null;
        this.restartToken = null;
        this.watcher = null;

        var lspEnabled = nova.config.get("nova-bicep.enable-language-server", "boolean")

        nova.config.onDidChange(
          'nova-bicep.enable-language-server',
          function (current, _previous) {
            if (current) {
              this.start();
            } else {
              this.stop();
            }
          },
          this
        );

        nova.config.onDidChange("nova-bicep.language-server-path", (_path) => {
            if (lspEnabled) {
             this.start();
            }
        }, this)

        nova.config.onDidChange("nova-bicep.dotnet-path", (_path) => {
            if (lspEnabled) {
             this.start();
            }
        }, this)

        if (lspEnabled) {
         this.start();
        }

        nova.workspace.onDidChangePath((_path) => {
            this.startWatcher();
        }, this);

        languageServer = this;

        this.startWatcher();
    }

    deactivate() {
        this.stop();

        if (this.watcher) {
            this.watcher.dispose()
            this.watcher = null;
        }

        if (this.restartToken) {
            clearTimeout(this.restartToken)
        }
    }

    startWatcher() {
        if (this.watcher) {
            this.watcher.dispose()
            this.watcher = null;
        }

        let workspacePath = nova.workspace.path;
        if (workspacePath) {
            this.watcher = nova.fs.watch("compile_commands.json", (path) => {
                languageServer.fileDidChange(path);
            });
        }
    }

    start() {
        console.log("Starting client")

        this.stop()

        let path = nova.config.get("nova-bicep.language-server-path");
        if (!path) {
            notify(
                "Bicep language server not installed, please install or disable the language server.",
                ["Disable", "Download"],
                (reply) => {
                    if (reply.actionIdx == 0) {
                        nova.config.set("nova-bicep", false)
                    } else if (reply.actionIdx == 1) {
                        nova.env.openURL("https://github.com/Azure/bicep/releases/latest")
                    }
                }
            )
        }

        let cmd = nova.config.get("nova-bicep.dotnet-path");

        let serverOptions = {
            path: cmd,
            args: [path],
        };

        let clientOptions = {
            syntaxes: [
                "bicep",
            ]
        };

        let client = new LanguageClient("bicep-lsp", "Bicep Langauge Server", serverOptions, clientOptions);

        client.onDidStop((error) => {
            if (error) {
                notify(
                    `Bicep language server quit unexpectedly with error: ${error}`,
                    ["Restart", "Ignore"],
                    (reply) => {
                        if (reply.actionIdx == 0) {
                            languageServer.start();
                        }
                    }
                )
            }
        }, this);

        try {
            client.start();

            nova.subscriptions.add(client);
            this.languageClient = client;
        } catch (err) {
            console.error(err);
        }
    }

    stop() {
        let langclient = this.languageClient;
        this.languageClient = null;

        if (langclient) {
            langclient.stop();
            nova.subscriptions.remove(langclient);
        }
    }

    fileDidChange(path) {
        let lastPathComponent = nova.path.basename(path);
        if (lastPathComponent == "compile_commands.json" || lastPathComponent == "compile_flags.txt") {
            this.scheduleRestart()
        }
    }

    scheduleRestart() {
        let token = this.restartToken;
        if (token != null) {
            clearTimeout(token);
        }

        let languageServer = this;
        this.restartToken = setTimeout(() => {
            languageServer.start();
        }, 1000);
    }
}

function notify(body, actions, handler) {
    let request = new NotificationRequest("bicep")

    request.title = "Bicep"
    request.body = body
    if (actions) request.actions = actions

    nova.notifications.add(request).then(reply => {
        if (handler) handler(reply)
    }, err => console.error(err))
}
