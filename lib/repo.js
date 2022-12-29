const nodegit = require('nodegit');

async function getStaged(repo) {
    const head = await repo.getHeadCommit();

    try {
        const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        const headTree = await (head
            ? head.getTree()
            : nodegit.Tree.lookup(repo, emptyTree)
        );
        return await nodegit.Diff.treeToIndex(repo, headTree, null);
    } catch (err) {
        console.warn('Cannot fetch staged changes:', err.message);
    }
}

async function getUnstaged(repo) {
    const Diff = nodegit.Diff;
    return await Diff.indexToWorkdir(repo, null, {
        flags: Diff.OPTION.SHOW_UNTRACKED_CONTENT
            | Diff.OPTION.RECURSE_UNTRACKED_DIRS
    });
}

module.exports = {
    getStaged,
    getUnstaged
};
