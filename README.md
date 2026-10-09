# claude-mods

Mods for Claude Code: plugins of function hooks that draw panes and react to what a session does.

## ticket-board

A live board of an `/implement-spec` run. Each ticket in `.scratch/<feature>/issues/` is a card in a column (Blocked, Ready, In progress, Needs you, Done). An agent's card shows what it is doing right now. Clicking the card opens that agent's conversation in the pane, live, and its Message button sends the agent a correction directly. The card of the agent you have open in the main view is marked.

An agent joins the board when its prompt names a `.scratch/<feature>/` path. Name agents after their ticket (`VI-9-02`, `merge-VI-9-02`) to put them on the right card. Open the board with `/board`; it also opens by itself when the first ticket agent starts.

## suggestion-chip

When Claude guesses your next prompt (the dim text in the empty prompt box), the guess also shows in a bar above the prompt, with a Send button that sends it as if you typed it. The bar stays while you type a draft of your own, hides while a turn runs, and goes away once any prompt is sent.

## Install

In a Claude Code terminal session:

```
/plugin install ticket-board --marketplace sandergo90/claude-mods
/plugin install suggestion-chip --marketplace sandergo90/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

## Develop

Run a mod's tests with `claude plugin test ticket-board`, and check it with `claude plugin validate ticket-board`. With the marketplace added from a local clone (`claude plugin marketplace add <clone>`), `/reload-plugins` picks up edits without a reinstall.
