
export interface UserDataFile {
    Version: 3
    Meta: {
        UserDataCount: number
        TotalUserDataSize: number
    }
    UserData: {
        Target: 'ArtMesh'
        Id: string
        Value: string
    }[]
}

type UserDataEntry = UserDataFile['UserData'][0]

export type ArtMeshToTagsMap = { [key: string]: string[] }

export function getArtMeshToTagsMap(file: UserDataFile): ArtMeshToTagsMap {
    return file.UserData.reduce((p, c) => ({ ...p, [c.Id]: c.Value.trim().split(/\s+/) }), {} as ArtMeshToTagsMap)
}

export function buildUserDataFile(artMeshesToTags: ArtMeshToTagsMap): UserDataFile {
    const artMeshes = Object.keys(artMeshesToTags)

    const entries: UserDataEntry[] = []
    for (const artMesh of artMeshes) {
        const tags = artMeshesToTags[artMesh]

        const entry: UserDataEntry = {
            Target: 'ArtMesh',
            Id: artMesh,
            Value: tags.join(' '),
        }
        entries.push(entry)
    }

    const totalUserDataSize = entries.reduce((p, c) => p + c.Value.length, 0)

    return {
        Version: 3,
        Meta: {
            UserDataCount: entries.length,
            TotalUserDataSize: totalUserDataSize,
        },
        UserData: entries,
    }
}
