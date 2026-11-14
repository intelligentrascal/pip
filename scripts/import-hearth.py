#!/usr/bin/env python3
"""Import only registered artwork data; never execute or ship a handoff demo."""
import hashlib, json, pathlib, re, stat, struct, sys, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
TARGET=ROOT/'assets/curious-hearth'

def png_size(data):
    assert data[:8]==b'\x89PNG\r\n\x1a\n' and data[12:16]==b'IHDR', 'PNG required'
    assert data[24:26]==bytes([8,6]), 'Cropped RGBA input required'
    # Textual metadata is not needed by the app and must not ride with artwork.
    position=8
    while position<len(data):
        length=struct.unpack('>I',data[position:position+4])[0]
        kind=data[position+4:position+8]
        assert kind not in [b'tEXt',b'zTXt',b'iTXt',b'eXIf'], 'Remove private metadata before importing artwork'
        position+=12+length
    return list(struct.unpack('>II',data[16:24]))

def import_art(archive):
    with zipfile.ZipFile(archive) as bundle:
        infos=bundle.infolist()
        assert sum(item.file_size for item in infos)<64*1024*1024, 'Archive exceeds import bound'
        for item in infos:
            name=pathlib.PurePosixPath(item.filename)
            assert not name.is_absolute() and '..' not in name.parts and not stat.S_ISLNK(item.external_attr>>16), 'Unsafe archive entry'
        candidates=[item for item in infos if pathlib.PurePosixPath(item.filename).name=='manifest.json']
        assert len(candidates)==1, 'One registration manifest required'
        source=json.loads(bundle.read(candidates[0]));base=pathlib.PurePosixPath(candidates[0].filename).parent
        canvas=source['canvas'];assert len(canvas)==2 and all(type(n) is int and 0<n<=2048 for n in canvas)
        files={};parts={}
        def read_image(name):
            assert re.fullmatch(r'[a-z0-9-]+\.png',name), 'Local artwork filename required'
            data=bundle.read(str(base/name));png_size(data);files[name]=data;return data
        for name,part in source['parts'].items():
            assert re.fullmatch(r'[a-z0-9-]+',name)
            data=read_image(part['file']);assert hashlib.sha256(data).hexdigest()==part['sha256'], 'Artwork hash differs'
            size=png_size(data);assert size==part['size'], 'Artwork registration differs'
            x,y=part['offset'];w,h=size;assert all(type(n) is int for n in [x,y,w,h]) and x>=0 and y>=0 and x+w<=canvas[0] and y+h<=canvas[1]
            pivot=part['pivot'];assert len(pivot)==2 and all(type(n) is int and 0<=n<=canvas[i] for i,n in enumerate(pivot))
            assert part['parent']=='root' or part['parent'] in source['group_pivots'], 'Unresolved logical parent'
            parts[name]={'file':part['file'],'offset':[x,y],'size':size,'pivot':pivot,'parent':part['parent']}
        order=source['draw_order'];assert len(order)==len(set(order)) and all(n in parts for n in order)
        variants={'closed-eye-left','closed-eye-right','mouth-neutral','mouth-concern'}
        assert set(parts)-set(order)==variants, 'Review new optional facial variants'
        # Optional face variants occupy the same paint slot as their base part.
        for base_name,alternates in [('eye-left',['closed-eye-left']),('eye-right',['closed-eye-right']),('mouth-smile',['mouth-neutral','mouth-concern'])]:
            at=order.index(base_name)+1;order[at:at]=alternates
        groups={}
        for name,pivot in source['group_pivots'].items():
            assert name in ['head','left-arm','right-arm'] and len(pivot)==2 and all(type(n) is int and 0<=n<=canvas[i] for i,n in enumerate(pivot))
            groups[name]={'parent':'root','pivot':pivot}
        outline=source['outline'];data=read_image(outline['file']);assert png_size(data)==outline['size']
        fallback='assembled-rest.png';read_image(fallback)
        assert png_size(files[fallback])==canvas
        manifest={'schema':1,'assetSet':'pip-curious-hearth','canvas':canvas,'targetPoints':112,'groups':groups,'parts':parts,'paintOrder':order,'optionalParts':sorted(variants),'outline':{key:outline[key] for key in ['file','offset','size']},'fallback':fallback,'fileHashes':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
        TARGET.mkdir(parents=True,exist_ok=True)
        for name,data in files.items():(TARGET/name).write_bytes(data)
        (TARGET/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        print('Imported registered Curious Hearth artwork; no demo, account metadata or executable handoff code copied.')

if __name__=='__main__':
    import_art(sys.argv[1])
