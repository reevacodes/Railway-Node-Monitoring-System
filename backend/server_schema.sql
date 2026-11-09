--
-- PostgreSQL database dump
--

\restrict b0LvCV3L8woJJrgdGBY0lNmjm4fl4qSAjwzKfsBOXkv3ZjMwGhb0HVlCn2Mu0S1

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: arp_discoveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arp_discoveries (
    id integer NOT NULL,
    snapshot_id integer,
    ip_address character varying(45) NOT NULL,
    mac_address character varying(50),
    normalized_mac character varying(32),
    interface character varying(50),
    arp_state character varying(30),
    is_router_entry boolean DEFAULT false,
    has_mac boolean DEFAULT true,
    matched_inventory_id integer,
    match_status character varying(30) DEFAULT 'unmatched'::character varying,
    discovered_at timestamp with time zone DEFAULT now()
);


--
-- Name: arp_discoveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.arp_discoveries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: arp_discoveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.arp_discoveries_id_seq OWNED BY public.arp_discoveries.id;


--
-- Name: arp_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arp_snapshots (
    id integer NOT NULL,
    snapshot_name character varying(150) NOT NULL,
    source_device character varying(100) DEFAULT 'Sophos XGS2100'::character varying,
    imported_at timestamp with time zone DEFAULT now(),
    total_entries integer DEFAULT 0,
    entries_with_mac integer DEFAULT 0,
    matched_inventory_count integer DEFAULT 0,
    unmatched_count integer DEFAULT 0,
    invalid_entries_count integer DEFAULT 0,
    notes text
);


--
-- Name: arp_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.arp_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: arp_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.arp_snapshots_id_seq OWNED BY public.arp_snapshots.id;


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    ip_address character varying(45),
    mac_address character varying(17),
    device_type character varying(50),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    building character varying(100),
    floor character varying(50),
    room character varying(100),
    rack character varying(100),
    rack_position character varying(50),
    port_number character varying(50),
    parent_device_id integer,
    parent_device_name character varying(100),
    location_notes text,
    location_verification character varying(20) DEFAULT 'unverified'::character varying,
    location_verified_at timestamp with time zone,
    office character varying(50)
);


--
-- Name: devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;


--
-- Name: discovered_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovered_devices (
    id integer NOT NULL,
    ip_address character varying(45) NOT NULL,
    mac_address character varying(50),
    normalized_mac character varying(32),
    interface character varying(50),
    arp_state character varying(30),
    custom_name character varying(100),
    device_type character varying(50) DEFAULT 'PC'::character varying,
    department character varying(150),
    building_location character varying(150),
    notes text,
    is_monitored boolean DEFAULT true,
    last_ping_status character varying(10),
    last_ping_latency integer,
    last_ping_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now(),
    snapshot_id integer,
    matched_inventory_id integer,
    registered_device_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT discovered_devices_last_ping_status_check CHECK (((last_ping_status)::text = ANY (ARRAY[('online'::character varying)::text, ('offline'::character varying)::text, ('unknown'::character varying)::text])))
);


--
-- Name: discovered_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.discovered_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: discovered_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.discovered_devices_id_seq OWNED BY public.discovered_devices.id;


--
-- Name: mac_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mac_inventory (
    id integer NOT NULL,
    mac_address character varying(50),
    normalized_mac character varying(32),
    raw_mac_entry text,
    device_name character varying(100),
    site_station character varying(100),
    department_location character varying(150),
    device_type character varying(50) DEFAULT 'PC'::character varying,
    vlan_id character varying(50),
    expected_ip character varying(50),
    notes text,
    is_multi_mac boolean DEFAULT false,
    multi_mac_group_id bigint,
    device_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mac_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mac_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mac_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mac_inventory_id_seq OWNED BY public.mac_inventory.id;


--
-- Name: sophos_poller_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sophos_poller_status (
    id integer DEFAULT 1 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_success_at timestamp with time zone,
    snapshot_created_at timestamp with time zone,
    polling_status character varying(50) DEFAULT 'idle'::character varying,
    last_error text,
    last_duration_ms integer,
    last_snapshot_id integer,
    total_entries integer,
    entries_with_mac integer,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT single_row CHECK ((id = 1))
);


--
-- Name: status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_history (
    id integer NOT NULL,
    device_id integer NOT NULL,
    status character varying(10) NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    latency_ms integer,
    CONSTRAINT status_history_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT status_history_status_check CHECK (((status)::text = ANY (ARRAY[('online'::character varying)::text, ('offline'::character varying)::text, ('unknown'::character varying)::text])))
);


--
-- Name: status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.status_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.status_history_id_seq OWNED BY public.status_history.id;


--
-- Name: arp_discoveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arp_discoveries ALTER COLUMN id SET DEFAULT nextval('public.arp_discoveries_id_seq'::regclass);


--
-- Name: arp_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arp_snapshots ALTER COLUMN id SET DEFAULT nextval('public.arp_snapshots_id_seq'::regclass);


--
-- Name: devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);


--
-- Name: discovered_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_devices ALTER COLUMN id SET DEFAULT nextval('public.discovered_devices_id_seq'::regclass);


--
-- Name: mac_inventory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mac_inventory ALTER COLUMN id SET DEFAULT nextval('public.mac_inventory_id_seq'::regclass);


--
-- Name: status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_history ALTER COLUMN id SET DEFAULT nextval('public.status_history_id_seq'::regclass);


--
-- Name: arp_discoveries arp_discoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arp_discoveries
    ADD CONSTRAINT arp_discoveries_pkey PRIMARY KEY (id);


--
-- Name: arp_snapshots arp_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arp_snapshots
    ADD CONSTRAINT arp_snapshots_pkey PRIMARY KEY (id);


--
-- Name: devices devices_ip_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_ip_address_key UNIQUE (ip_address);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: discovered_devices discovered_devices_ip_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_devices
    ADD CONSTRAINT discovered_devices_ip_address_key UNIQUE (ip_address);


--
-- Name: discovered_devices discovered_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_devices
    ADD CONSTRAINT discovered_devices_pkey PRIMARY KEY (id);


--
-- Name: mac_inventory mac_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mac_inventory
    ADD CONSTRAINT mac_inventory_pkey PRIMARY KEY (id);


--
-- Name: sophos_poller_status sophos_poller_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sophos_poller_status
    ADD CONSTRAINT sophos_poller_status_pkey PRIMARY KEY (id);


--
-- Name: status_history status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_history
    ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);


--
-- Name: idx_arp_disc_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arp_disc_ip ON public.arp_discoveries USING btree (ip_address);


--
-- Name: idx_arp_disc_match; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arp_disc_match ON public.arp_discoveries USING btree (match_status);


--
-- Name: idx_arp_disc_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arp_disc_norm ON public.arp_discoveries USING btree (normalized_mac);


--
-- Name: idx_arp_disc_snap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arp_disc_snap ON public.arp_discoveries USING btree (snapshot_id);


--
-- Name: idx_disc_dev_iface; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_dev_iface ON public.discovered_devices USING btree (interface);


--
-- Name: idx_disc_dev_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_dev_ip ON public.discovered_devices USING btree (ip_address);


--
-- Name: idx_disc_dev_mac; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_dev_mac ON public.discovered_devices USING btree (normalized_mac);


--
-- Name: idx_disc_dev_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_dev_status ON public.discovered_devices USING btree (last_ping_status);


--
-- Name: idx_mac_inv_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mac_inv_dept ON public.mac_inventory USING btree (department_location);


--
-- Name: idx_mac_inv_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mac_inv_norm ON public.mac_inventory USING btree (normalized_mac);


--
-- Name: arp_discoveries arp_discoveries_matched_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arp_discoveries
    ADD CONSTRAINT arp_discoveries_matched_inventory_id_fkey FOREIGN KEY (matched_inventory_id) REFERENCES public.mac_inventory(id) ON DELETE SET NULL;


--
-- Name: arp_discoveries arp_discoveries_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arp_discoveries
    ADD CONSTRAINT arp_discoveries_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.arp_snapshots(id) ON DELETE CASCADE;


--
-- Name: devices devices_parent_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_parent_device_id_fkey FOREIGN KEY (parent_device_id) REFERENCES public.devices(id) ON DELETE SET NULL;


--
-- Name: discovered_devices discovered_devices_matched_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_devices
    ADD CONSTRAINT discovered_devices_matched_inventory_id_fkey FOREIGN KEY (matched_inventory_id) REFERENCES public.mac_inventory(id) ON DELETE SET NULL;


--
-- Name: discovered_devices discovered_devices_registered_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_devices
    ADD CONSTRAINT discovered_devices_registered_device_id_fkey FOREIGN KEY (registered_device_id) REFERENCES public.devices(id) ON DELETE SET NULL;


--
-- Name: discovered_devices discovered_devices_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_devices
    ADD CONSTRAINT discovered_devices_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.arp_snapshots(id) ON DELETE SET NULL;


--
-- Name: mac_inventory mac_inventory_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mac_inventory
    ADD CONSTRAINT mac_inventory_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE SET NULL;


--
-- Name: sophos_poller_status sophos_poller_status_last_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sophos_poller_status
    ADD CONSTRAINT sophos_poller_status_last_snapshot_id_fkey FOREIGN KEY (last_snapshot_id) REFERENCES public.arp_snapshots(id) ON DELETE SET NULL;


--
-- Name: status_history status_history_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_history
    ADD CONSTRAINT status_history_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict b0LvCV3L8woJJrgdGBY0lNmjm4fl4qSAjwzKfsBOXkv3ZjMwGhb0HVlCn2Mu0S1

