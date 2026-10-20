<svelte:head
	><title>Privacy · antre</title><meta
		name="description"
		content="How Antre stores account connections, drafts, and publishing data."
	/></svelte:head
>

<main>
	<h1>Privacy</h1>
	<p>
		Antre is a private tool for reviewing drafts and scheduling posts for its
		account owner.
	</p>
	<h2>What Antre stores</h2>
	<p>
		Antre stores connected account identifiers and display names, access tokens
		and their expiry times, drafts, attachments, posting schedules, and
		publishing results. Its Threads features also store replies and engagement
		data obtained through the account connection.
	</p>
	<h2>How the data is used</h2>
	<p>
		Account access lets Antre publish posts that the owner queues or chooses to
		publish. Drafts remain in Antre until the owner sends them. LinkedIn and
		Threads have separate drafts and schedules.
	</p>
	<h2>Where data goes</h2>
	<p>
		Vercel hosts the application. Convex stores application data and runs
		publishing jobs. Publishing sends the selected post to its connected
		platform. An agent given access to Antre's MCP endpoint can read and change
		content through the tools exposed there.
	</p>
	<h2>Access and removal</h2>
	<p>
		The owner can remove local drafts in Antre and revoke Antre's access in
		LinkedIn or Threads account settings. Removing a local post does not remove
		a post that has already been published on those platforms. Revoking a
		connection prevents future API access but does not erase Antre's stored
		drafts.
	</p>
	<p>
		For a request about this app or stored data, contact the maintainer through <a
			href="https://github.com/Mona-kecil/antre/issues">the Antre repository</a
		>. Do not include passwords or access tokens in an issue.
	</p>
	<p><a href="/">Back to Antre</a></p>
</main>

<style>
	main {
		padding: 32px 20px;
	}
	h1 {
		font-size: 20px;
		line-height: 1.3;
		margin: 0 0 20px;
	}
	h2 {
		font-size: 17px;
		margin: 28px 0 8px;
	}
	p {
		margin: 0 0 16px;
		line-height: 1.65;
	}
	a {
		color: inherit;
		text-underline-offset: 3px;
	}
</style>
